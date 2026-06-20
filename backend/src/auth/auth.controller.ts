import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from './decorators/current-user.decorator';
import { UsersService } from '../users/users.service';

// Auth endpoints get a stricter per-IP throttle than the global default. The
// window/limit are read from env so a load-test environment can lift them
// without a code change (defaults keep the strict 10/60s in prod). Read at
// module load from process.env — `@Throttle` is a static decorator and can't
// use the DI config service; in Docker these vars are injected by compose
// before the process starts, so they're reliably present here.
const AUTH_THROTTLE = {
  default: {
    ttl: (Number(process.env.THROTTLE_AUTH_TTL) || 60) * 1000,
    limit: Number(process.env.THROTTLE_AUTH_LIMIT) || 10,
  },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    // req.ip is the real client IP thanks to `trust proxy` (set in main.ts).
    return this.auth.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('refresh')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.userId);
  }

  @Patch('me/password')
  @Throttle(AUTH_THROTTLE)
  @ApiBearerAuth()
  @UseGuards(JwtAccessGuard)
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
