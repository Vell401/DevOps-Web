import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { DocsService, DOC_IMAGE_MAX_BYTES } from './docs.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { CreateSpaceDto } from './dto/create-space.dto';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { AddDocMemberDto, UpdateDocMemberDto } from './dto/doc-member.dto';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { SearchDocsDto } from './dto/search-docs.dto';

@ApiTags('docs')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard)
@Controller('docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  // ---- spaces ----

  @Get('spaces')
  listSpaces(@CurrentUser() u: AuthenticatedUser) {
    return this.docs.listSpaces(u.userId);
  }

  @Post('spaces')
  createSpace(@Body() dto: CreateSpaceDto, @CurrentUser() u: AuthenticatedUser) {
    return this.docs.createSpace(u.userId, dto);
  }

  @Get('spaces/:id')
  getSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.getSpace(id, u.userId);
  }

  @Patch('spaces/:id')
  updateSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpaceDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.updateSpace(id, u.userId, dto);
  }

  @Delete('spaces/:id')
  @HttpCode(204)
  async deleteSpace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ): Promise<void> {
    await this.docs.deleteSpace(id, u.userId);
  }

  @Get('spaces/:id/search')
  search(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SearchDocsDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.search(id, u.userId, query.q);
  }

  // ---- members (owner invites) ----

  @Get('spaces/:id/members')
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.listMembers(id, u.userId);
  }

  @Post('spaces/:id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDocMemberDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.addMember(id, u.userId, dto.userId, dto.role);
  }

  @Patch('spaces/:id/members/:memberId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateDocMemberDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.updateMember(id, u.userId, memberId, dto.role);
  }

  @Delete('spaces/:id/members/:memberId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.removeMember(id, u.userId, memberId);
  }

  // ---- pages ----

  @Post('spaces/:id/pages')
  createPage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePageDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.createPage(id, u.userId, dto);
  }

  @Get('pages/:id')
  getPage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.getPage(id, u.userId);
  }

  @Patch('pages/:id')
  updatePage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePageDto,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.docs.updatePage(id, u.userId, dto);
  }

  @Delete('pages/:id')
  @HttpCode(204)
  async deletePage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ): Promise<void> {
    await this.docs.deletePage(id, u.userId);
  }

  // ---- images ----

  @Post('pages/:id/images')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DOC_IMAGE_MAX_BYTES } }),
  )
  uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided (multipart field "file")');
    }
    return this.docs.uploadImage(id, u.userId, file);
  }

  /** Image bytes for an embedded screenshot — auth required, served via proxy.
   *  (<img> tags can't send a Bearer header, so the frontend resolves these
   *  through the API client into an object URL — see the docs editor.) */
  @Get('images/:id')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, mimeType } = await this.docs.getImageStream(id, u.userId);
    res.set({
      'Content-Type': mimeType,
      'Cache-Control': 'private, max-age=86400',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }
}
