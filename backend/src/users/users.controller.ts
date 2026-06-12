import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { AVATAR_MAX_BYTES, UsersService } from './users.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES } }),
  )
  uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided (multipart field "file")');
    }
    return this.users.setAvatar(user.userId, file);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.users.removeAvatar(user.userId);
  }

  /** Avatar bytes for any user — auth required, served via the API proxy. */
  @Get(':id/avatar')
  async avatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType } = await this.users.getAvatarStream(id);
    res.set({
      'Content-Type': mimeType,
      // The object key changes on every upload, so the frontend cache-busts
      // by key; the response itself can be cached aggressively.
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }
}
