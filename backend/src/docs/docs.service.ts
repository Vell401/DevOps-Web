import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocRole, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';

import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateSpaceDto } from './dto/create-space.dto';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { CreatePageDto } from './dto/create-page.dto';
import { UpdatePageDto } from './dto/update-page.dto';

/** Effective role in a doc space; the owner outranks both member roles. */
export type EffectiveDocRole = DocRole | 'OWNER';

const RANK: Record<EffectiveDocRole, number> = { READER: 0, WRITER: 1, OWNER: 2 };
function atLeast(role: EffectiveDocRole | null, min: EffectiveDocRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

const USER_LITE = {
  select: { id: true, name: true, email: true, avatarColor: true, avatarKey: true },
} as const;

// SVG excluded for the same stored-XSS reason as task attachments/avatars.
const IMG_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export const DOC_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class DocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ----------------- Access -----------------

  private async isGlobalAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });
    return u?.isAdmin ?? false;
  }

  /**
   * Effective role: OWNER, the member-row role, WRITER for a global admin
   * (oversight, mirrors projects), or null with no access. Throws 404 if the
   * space is missing.
   */
  async roleInSpace(spaceId: string, userId: string): Promise<EffectiveDocRole | null> {
    const space = await this.prisma.docSpace.findUnique({
      where: { id: spaceId },
      select: { ownerId: true },
    });
    if (!space) throw new NotFoundException('Doc space not found');
    if (space.ownerId === userId) return 'OWNER';
    const member = await this.prisma.docSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      select: { role: true },
    });
    if (member) return member.role;
    if (await this.isGlobalAdmin(userId)) return DocRole.WRITER;
    return null;
  }

  async assertSpaceRole(
    spaceId: string,
    userId: string,
    min: EffectiveDocRole,
  ): Promise<EffectiveDocRole> {
    const role = await this.roleInSpace(spaceId, userId);
    if (!atLeast(role, min)) throw new ForbiddenException();
    return role as EffectiveDocRole;
  }

  /** Used by the realtime gateway to gate room subscription. */
  async canAccess(spaceId: string, userId: string): Promise<boolean> {
    try {
      return (await this.roleInSpace(spaceId, userId)) !== null;
    } catch {
      return false;
    }
  }

  private async assertOwner(spaceId: string, userId: string): Promise<void> {
    const space = await this.prisma.docSpace.findUnique({
      where: { id: spaceId },
      select: { ownerId: true },
    });
    if (!space) throw new NotFoundException('Doc space not found');
    if (space.ownerId !== userId) throw new ForbiddenException();
  }

  // ----------------- Spaces -----------------

  async listSpaces(userId: string) {
    const spaces = await this.prisma.docSpace.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { createdAt: 'asc' },
      include: {
        owner: USER_LITE,
        _count: { select: { pages: true } },
        members: { where: { userId }, select: { role: true } },
      },
    });
    return spaces.map(({ members, _count, ...s }) => ({
      ...s,
      pageCount: _count.pages,
      myRole: (s.ownerId === userId ? 'OWNER' : members[0]?.role ?? 'READER') as EffectiveDocRole,
    }));
  }

  async createSpace(userId: string, dto: CreateSpaceDto) {
    const space = await this.prisma.docSpace.create({
      data: { name: dto.name.trim(), icon: dto.icon, ownerId: userId },
    });
    this.realtime.emitDocSpacesChangedForUsers([userId]);
    return { ...space, myRole: 'OWNER' as const, pageCount: 0 };
  }

  /** Space header + the full page tree (titles/icons/parents only — content is
   *  fetched per page). Any role; throws 403 without access. */
  async getSpace(spaceId: string, userId: string) {
    const myRole = await this.roleInSpace(spaceId, userId);
    if (!myRole) throw new ForbiddenException();
    const space = await this.prisma.docSpace.findUniqueOrThrow({
      where: { id: spaceId },
      include: { owner: USER_LITE },
    });
    const pages = await this.prisma.docPage.findMany({
      where: { spaceId },
      select: {
        id: true,
        title: true,
        icon: true,
        parentId: true,
        position: true,
        updatedAt: true,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      id: space.id,
      name: space.name,
      icon: space.icon,
      ownerId: space.ownerId,
      owner: space.owner,
      createdAt: space.createdAt,
      myRole,
      pages,
    };
  }

  async updateSpace(spaceId: string, userId: string, dto: UpdateSpaceDto) {
    await this.assertSpaceRole(spaceId, userId, DocRole.WRITER);
    const space = await this.prisma.docSpace.update({
      where: { id: spaceId },
      data: { name: dto.name?.trim(), icon: dto.icon },
    });
    this.realtime.emitDocTreeChanged(spaceId);
    return space;
  }

  async deleteSpace(spaceId: string, userId: string): Promise<void> {
    await this.assertOwner(spaceId, userId);
    const [images, memberIds] = await Promise.all([
      this.prisma.docImage.findMany({
        where: { page: { spaceId } },
        select: { key: true },
      }),
      this.prisma.docSpaceMember.findMany({
        where: { spaceId },
        select: { userId: true },
      }),
    ]);
    await this.prisma.docSpace.delete({ where: { id: spaceId } });
    await Promise.all(images.map((i) => this.storage.deleteObject(i.key).catch(() => undefined)));
    this.realtime.emitDocSpacesChangedForUsers([userId, ...memberIds.map((m) => m.userId)]);
  }

  // ----------------- Members (owner invites) -----------------

  async listMembers(spaceId: string, userId: string) {
    await this.assertSpaceRole(spaceId, userId, 'READER');
    const rows = await this.prisma.docSpaceMember.findMany({
      where: { spaceId },
      include: { user: USER_LITE },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({ ...m.user, role: m.role }));
  }

  async addMember(
    spaceId: string,
    userId: string,
    memberId: string,
    role: DocRole = DocRole.WRITER,
  ) {
    const space = await this.prisma.docSpace.findUnique({
      where: { id: spaceId },
      select: { ownerId: true },
    });
    if (!space) throw new NotFoundException('Doc space not found');
    if (space.ownerId !== userId) throw new ForbiddenException(); // only the creator invites
    if (memberId === space.ownerId) {
      throw new BadRequestException('Owner is already in the space');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.docSpaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId: memberId } },
      update: { role },
      create: { spaceId, userId: memberId, role },
    });
    this.realtime.emitDocSpacesChangedForUsers([memberId]);
    return this.listMembers(spaceId, userId);
  }

  async updateMember(
    spaceId: string,
    userId: string,
    memberId: string,
    role: DocRole,
  ) {
    await this.assertOwner(spaceId, userId);
    const existing = await this.prisma.docSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: memberId } },
      select: { userId: true },
    });
    if (!existing) throw new NotFoundException('Member not found');
    await this.prisma.docSpaceMember.update({
      where: { spaceId_userId: { spaceId, userId: memberId } },
      data: { role },
    });
    return this.listMembers(spaceId, userId);
  }

  async removeMember(spaceId: string, userId: string, memberId: string) {
    await this.assertOwner(spaceId, userId);
    await this.prisma.docSpaceMember.deleteMany({
      where: { spaceId, userId: memberId },
    });
    this.realtime.emitDocSpacesChangedForUsers([memberId]);
    return this.listMembers(spaceId, userId);
  }

  // ----------------- Pages -----------------

  async getPage(pageId: string, userId: string) {
    const page = await this.prisma.docPage.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, 'READER');
    return page;
  }

  async createPage(spaceId: string, userId: string, dto: CreatePageDto) {
    await this.assertSpaceRole(spaceId, userId, DocRole.WRITER);
    if (dto.parentId) await this.assertSameSpace(dto.parentId, spaceId);
    const last = await this.prisma.docPage.findFirst({
      where: { spaceId, parentId: dto.parentId ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const page = await this.prisma.docPage.create({
      data: {
        spaceId,
        parentId: dto.parentId ?? null,
        title: dto.title?.trim() || 'Untitled',
        icon: dto.icon,
        position: (last?.position ?? 0) + 1,
      },
    });
    this.realtime.emitDocTreeChanged(spaceId);
    return page;
  }

  async updatePage(pageId: string, userId: string, dto: UpdatePageDto) {
    const page = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, DocRole.WRITER);

    if (dto.parentId) {
      if (dto.parentId === pageId) {
        throw new BadRequestException('A page cannot be its own parent');
      }
      await this.assertSameSpace(dto.parentId, page.spaceId);
      if (await this.isInSubtree(dto.parentId, pageId)) {
        throw new BadRequestException('Cannot move a page into its own subtree');
      }
    }

    const data: Prisma.DocPageUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim() || 'Untitled';
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (Array.isArray(dto.content)) {
      data.content = dto.content as unknown as Prisma.InputJsonValue;
    }
    if (dto.contentText !== undefined) data.contentText = dto.contentText;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.docPage.update({ where: { id: pageId }, data });

    // Snapshot a version whenever the body content is saved.
    if (Array.isArray(dto.content)) {
      await this.snapshotRevision(pageId, userId, updated);
    }

    const structural =
      dto.title !== undefined ||
      dto.icon !== undefined ||
      dto.parentId !== undefined ||
      dto.position !== undefined;
    if (structural) this.realtime.emitDocTreeChanged(page.spaceId);
    if (dto.content !== undefined) this.realtime.emitDocPageUpdated(page.spaceId, pageId);
    return updated;
  }

  async deletePage(pageId: string, userId: string): Promise<void> {
    const page = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, DocRole.WRITER);

    const subtree = await this.collectSubtree(pageId);
    const images = await this.prisma.docImage.findMany({
      where: { pageId: { in: subtree } },
      select: { key: true },
    });
    await this.prisma.docPage.delete({ where: { id: pageId } }); // cascades children + image rows
    await Promise.all(images.map((i) => this.storage.deleteObject(i.key).catch(() => undefined)));
    this.realtime.emitDocTreeChanged(page.spaceId);
  }

  private async assertSameSpace(pageId: string, spaceId: string): Promise<void> {
    const p = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!p || p.spaceId !== spaceId) {
      throw new BadRequestException('Page is not in this space');
    }
  }

  /** True if `candidateId` lies in `rootId`'s subtree (walks up to the root). */
  private async isInSubtree(candidateId: string, rootId: string): Promise<boolean> {
    let cur: string | null = candidateId;
    for (let i = 0; i < 1000 && cur; i++) {
      if (cur === rootId) return true;
      const p = await this.prisma.docPage.findUnique({
        where: { id: cur },
        select: { parentId: true },
      });
      cur = p?.parentId ?? null;
    }
    return false;
  }

  private async collectSubtree(rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    for (let depth = 0; depth < 1000 && frontier.length; depth++) {
      const kids = await this.prisma.docPage.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = kids.map((k) => k.id);
      ids.push(...frontier);
    }
    return ids;
  }

  // ----------------- Images -----------------

  async uploadImage(pageId: string, userId: string, file: Express.Multer.File) {
    const page = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, DocRole.WRITER);

    const ext = IMG_MIME_TO_EXT[file.mimetype?.toLowerCase() ?? ''];
    if (!ext) throw new BadRequestException('Image must be JPEG, PNG, WebP or GIF');

    const key = `docs/${page.spaceId}/${pageId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const img = await this.prisma.docImage.create({
      data: {
        pageId,
        uploaderId: userId,
        key,
        filename: file.originalname?.slice(0, 200) ?? `image.${ext}`,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
    // The frontend embeds this URL in the block document; it's served by the
    // authenticated proxy below (the bucket is never exposed directly).
    return { id: img.id, url: `/api/docs/images/${img.id}` };
  }

  async getImageStream(
    imageId: string,
    userId: string,
  ): Promise<{ stream: Readable; mimeType: string }> {
    const img = await this.prisma.docImage.findUnique({
      where: { id: imageId },
      include: { page: { select: { spaceId: true } } },
    });
    if (!img) throw new NotFoundException('Image not found');
    await this.assertSpaceRole(img.page.spaceId, userId, 'READER');
    const stream = await this.storage.getObjectStream(img.key);
    return { stream, mimeType: img.mimeType };
  }

  // ----------------- Search -----------------

  async search(spaceId: string, userId: string, q: string) {
    await this.assertSpaceRole(spaceId, userId, 'READER');
    const term = q.trim();
    if (!term) return [];
    const pages = await this.prisma.docPage.findMany({
      where: {
        spaceId,
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { contentText: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true, icon: true, parentId: true, contentText: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return pages.map(({ contentText, ...p }) => ({
      ...p,
      snippet: snippetAround(contentText, term),
    }));
  }

  // ----------------- Revisions (version history) -----------------

  /** Snapshot the page's state after a content save. Saves are deliberate now
   *  (manual Edit/Save, gated behind real changes on the client), so each one is
   *  its own version; history is capped per page. */
  private async snapshotRevision(
    pageId: string,
    userId: string,
    page: { title: string; content: Prisma.JsonValue | null; contentText: string },
  ): Promise<void> {
    const contentValue =
      page.content === null ? Prisma.JsonNull : (page.content as Prisma.InputJsonValue);

    await this.prisma.docPageRevision.create({
      data: {
        pageId,
        editorId: userId,
        title: page.title,
        content: contentValue,
        contentText: page.contentText,
      },
    });
    await this.pruneRevisions(pageId);
  }

  /** Keep only the most recent 50 revisions per page. */
  private async pruneRevisions(pageId: string): Promise<void> {
    const stale = await this.prisma.docPageRevision.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.docPageRevision.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
    }
  }

  async listRevisions(pageId: string, userId: string) {
    const page = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, 'READER');
    return this.prisma.docPageRevision.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, editor: USER_LITE },
    });
  }

  async getRevision(revId: string, userId: string) {
    const rev = await this.prisma.docPageRevision.findUnique({
      where: { id: revId },
      include: { page: { select: { spaceId: true } } },
    });
    if (!rev) throw new NotFoundException('Revision not found');
    await this.assertSpaceRole(rev.page.spaceId, userId, 'READER');
    return {
      id: rev.id,
      pageId: rev.pageId,
      title: rev.title,
      content: rev.content,
      contentText: rev.contentText,
      createdAt: rev.createdAt,
    };
  }

  async restoreRevision(pageId: string, revId: string, userId: string) {
    const page = await this.prisma.docPage.findUnique({
      where: { id: pageId },
      select: { spaceId: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.assertSpaceRole(page.spaceId, userId, DocRole.WRITER);
    const rev = await this.prisma.docPageRevision.findUnique({ where: { id: revId } });
    if (!rev || rev.pageId !== pageId) throw new NotFoundException('Revision not found');

    const contentValue =
      rev.content === null ? Prisma.JsonNull : (rev.content as Prisma.InputJsonValue);
    const updated = await this.prisma.docPage.update({
      where: { id: pageId },
      data: { title: rev.title, content: contentValue, contentText: rev.contentText },
    });
    // Record the restore as a fresh revision so it shows in the history.
    await this.prisma.docPageRevision.create({
      data: {
        pageId,
        editorId: userId,
        title: updated.title,
        content: contentValue,
        contentText: updated.contentText,
      },
    });
    await this.pruneRevisions(pageId);
    this.realtime.emitDocTreeChanged(page.spaceId);
    this.realtime.emitDocPageUpdated(page.spaceId, pageId);
    return updated;
  }
}

/** A short excerpt of `text` centred on the first match of `term`. */
function snippetAround(text: string, term: string): string {
  if (!text) return '';
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, start + 120);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
