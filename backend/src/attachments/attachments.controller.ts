import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
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

import { AttachmentsService } from './attachments.service';
import { AppConfigService } from '../config/app-config.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

// Read at module-load time so the multer interceptor has a hard ceiling. Nest
// maps multer's LIMIT_FILE_SIZE to a 413 PayloadTooLargeException automatically.
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? '26214400', 10);

// Only these raster types are safe to serve `inline`. SVG is deliberately
// excluded: it can carry <script>, and serving it inline from the app origin
// (the SPA and API share one origin, and the global CSP is disabled) would be a
// stored-XSS vector — an attacker could steal the JWT from localStorage. Any
// other type (SVG, HTML, PDF, …) is forced to download instead of rendering.
const INLINE_SAFE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

@ApiTags('attachments')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly cfg: AppConfigService,
  ) {}

  @Post('tasks/:taskId/attachments')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided (multipart field "file")');
    }
    return this.attachments.create(taskId, user.userId, file);
  }

  @Get('tasks/:taskId/attachments')
  list(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.listForTask(taskId, user.userId);
  }

  @Get('attachments/:id')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { attachment, stream } = await this.attachments.getForDownload(
      id,
      user.userId,
    );
    const inline = INLINE_SAFE_MIME.has(attachment.mimeType.toLowerCase());
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(
        attachment.filename,
      )}"`,
      // Defence in depth: the app's global CSP is disabled, so lock down the
      // attachment response itself. `sandbox` neutralises any active content if
      // a file is ever opened directly; nosniff stops MIME-type guessing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.attachments.remove(id, user.userId);
  }
}
