import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarColor: true,
  avatarKey: true,
  isAdmin: true,
  createdAt: true,
} as const;

// Only safe raster formats; SVG is excluded for the same stored-XSS reason as
// task attachments. Extension doubles as the stored content-type marker.
const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3StorageService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  list() {
    return this.prisma.user.findMany({
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Upload/replace the profile photo. Old object is removed best-effort. */
  async setAvatar(userId: string, file: Express.Multer.File) {
    const ext = AVATAR_MIME_TO_EXT[file.mimetype?.toLowerCase() ?? ''];
    if (!ext) {
      throw new BadRequestException('Avatar must be a JPEG, PNG or WebP image');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const key = `avatars/${userId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: key },
      select: PUBLIC_USER_SELECT,
    });
    if (user.avatarKey) {
      await this.storage.deleteObject(user.avatarKey).catch(() => undefined);
    }
    return updated;
  }

  async removeAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null },
      select: PUBLIC_USER_SELECT,
    });
    if (user.avatarKey) {
      await this.storage.deleteObject(user.avatarKey).catch(() => undefined);
    }
    return updated;
  }

  /** Stream a user's avatar for any authenticated caller. */
  async getAvatarStream(
    targetUserId: string,
  ): Promise<{ stream: Readable; mimeType: string; key: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { avatarKey: true },
    });
    if (!user?.avatarKey) throw new NotFoundException('No avatar');
    const ext = user.avatarKey.split('.').pop() ?? '';
    const stream = await this.storage.getObjectStream(user.avatarKey);
    return {
      stream,
      mimeType: EXT_TO_MIME[ext] ?? 'application/octet-stream',
      key: user.avatarKey,
    };
  }
}
