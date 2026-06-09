import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminService } from './admin.service';
import { AdminUpdateUserDto } from './dto/update-user.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('users/:id/logins')
  userLogins(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.userLogins(id);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.updateUser(id, user.userId, dto);
  }

  @Delete('users/:id')
  @HttpCode(204)
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.admin.deleteUser(id, user.userId);
  }
}
