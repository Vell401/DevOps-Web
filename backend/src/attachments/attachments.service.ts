import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsService } from '../projects/projects.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const UPLOADER_LITE = {
  select: { id: true, name: true, email: true, avatarColor: true },
} as const;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly projects: ProjectsService,
    private readonly storage: S3StorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** List a task's attachments. Access = anyone who can see the task. */
  async listForTask(taskId: string, userId: string) {
    await this.tasks.get(taskId, userId); // throws if no access
    return this.prisma.attachment.findMany({
      where: { taskId },
      include: { uploader: UPLOADER_LITE },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Upload: any project member/assignee can attach to a task they can see. */
  async create(taskId: string, userId: string, file: Express.Multer.File) {
    const task = await this.tasks.get(taskId, userId); // access check
    await this.projects.assertNotClosed(task.projectId);

    const safeName = sanitizeName(file.originalname);
    const key = `tasks/${taskId}/${randomUUID()}-${safeName}`;
    const contentType = file.mimetype || 'application/octet-stream';
    await this.storage.putObject(key, file.buffer, contentType);

    const attachment = await this.prisma.attachment.create({
      data: {
        taskId,
        uploaderId: userId,
        key,
        filename: safeName,
        mimeType: contentType,
        size: file.size,
      },
      include: { uploader: UPLOADER_LITE },
    });

    this.realtime.emitAttachmentAdded(task.projectId, taskId, attachment);
    const members = await this.projects.memberIds(task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
    return attachment;
  }

  /** Resolve an attachment + its object stream for download, after access check. */
  async getForDownload(id: string, userId: string) {
    const att = await this.prisma.attachment.findUnique({ where: { id } });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.tasks.get(att.taskId, userId); // access check
    const stream = await this.storage.getObjectStream(att.key);
    return { attachment: att, stream };
  }

  /** Delete: uploader or project owner; blocked on closed projects. */
  async remove(id: string, userId: string): Promise<void> {
    const att = await this.prisma.attachment.findUnique({
      where: { id },
      include: {
        task: {
          select: {
            id: true,
            projectId: true,
            project: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!att) throw new NotFoundException('Attachment not found');

    const isUploader = att.uploaderId === userId;
    const isOwner = att.task.project.ownerId === userId;
    if (!isUploader && !isOwner) throw new ForbiddenException();
    await this.projects.assertNotClosed(att.task.projectId);

    await this.prisma.attachment.delete({ where: { id } });
    // Best-effort object removal — the DB row is the source of truth for the UI.
    try {
      await this.storage.deleteObject(att.key);
    } catch {
      /* orphaned object left in the bucket; acceptable for this project */
    }

    this.realtime.emitAttachmentRemoved(att.task.projectId, att.task.id, id);
    const members = await this.projects.memberIds(att.task.projectId);
    this.realtime.emitProjectsChangedForUsers([...members, userId]);
  }
}

/** Strip any path, keep a safe basename for display/download. */
function sanitizeName(name: string): string {
  const base = (name || 'file').split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file';
}
