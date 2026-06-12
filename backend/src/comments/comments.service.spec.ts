import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { CommentsService } from './comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { ProjectsService } from '../projects/projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { S3StorageService } from '../storage/s3-storage.service';

describe('CommentsService', () => {
  let service: CommentsService;

  const txMock = {
    comment: { create: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    attachment: { updateMany: jest.fn() },
  };
  const prismaMock = {
    comment: { findUnique: jest.fn(), delete: jest.fn() },
    attachment: { count: jest.fn() },
    notification: { findMany: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  const tasksMock = { get: jest.fn() };
  const activityMock = { log: jest.fn() };
  const projectsMock = {
    assertNotClosed: jest.fn(),
    roleIn: jest.fn(),
    memberIds: jest.fn().mockResolvedValue([]),
  };
  const realtimeMock = {
    emitCommentAdded: jest.fn(),
    emitCommentUpdated: jest.fn(),
    emitCommentDeleted: jest.fn(),
    emitAttachmentRemoved: jest.fn(),
    emitNotification: jest.fn(),
    emitProjectsChangedForUsers: jest.fn(),
  };
  const notificationsMock = {
    notify: jest.fn().mockResolvedValue([]),
  };
  const storageMock = { deleteObject: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    projectsMock.memberIds.mockResolvedValue([]);
    notificationsMock.notify.mockResolvedValue([]);
    storageMock.deleteObject.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksService, useValue: tasksMock },
        { provide: ActivityService, useValue: activityMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: RealtimeGateway, useValue: realtimeMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: S3StorageService, useValue: storageMock },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
  });

  describe('create (mentions + attachments)', () => {
    beforeEach(() => {
      tasksMock.get.mockResolvedValue({ id: 't1', projectId: 'p1' });
      txMock.comment.create.mockResolvedValue({ id: 'c1' });
      txMock.comment.findUniqueOrThrow.mockResolvedValue({
        id: 'c1',
        body: 'hi',
        attachments: [],
      });
      activityMock.log.mockResolvedValue({ id: 'a1' });
    });

    it('notifies only mentioned project participants, never the author', async () => {
      projectsMock.memberIds.mockResolvedValue(['author', 'member', 'assignee']);
      notificationsMock.notify.mockResolvedValueOnce([
        { id: 'n1', userId: 'member' },
      ]);

      await service.create('t1', 'author', {
        body: 'hi @Member @Stranger @Author',
        // author mentions themself, a participant, a duplicate and an outsider
        mentions: ['member', 'member', 'author', 'stranger'],
      });

      expect(notificationsMock.notify).toHaveBeenCalledWith(
        {
          recipientIds: ['member'],
          type: NotificationType.MENTIONED,
          actorId: 'author',
          taskId: 't1',
          commentId: 'c1',
        },
        txMock,
      );
      // The created notification is pushed to the recipient's socket room.
      expect(realtimeMock.emitNotification).toHaveBeenCalledWith('member', {
        id: 'n1',
        userId: 'member',
      });
    });

    it('links staged attachments to the new comment after validating them', async () => {
      prismaMock.attachment.count.mockResolvedValueOnce(2);

      await service.create('t1', 'author', {
        body: 'with files',
        attachmentIds: ['att1', 'att2'],
      });

      // Validation: same task, uploaded by the author, not yet linked.
      expect(prismaMock.attachment.count).toHaveBeenCalledWith({
        where: {
          id: { in: ['att1', 'att2'] },
          taskId: 't1',
          uploaderId: 'author',
          commentId: null,
        },
      });
      expect(txMock.attachment.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['att1', 'att2'] }, taskId: 't1', commentId: null },
        data: { commentId: 'c1' },
      });
    });

    it('rejects attachments that fail validation (foreign/claimed/not yours)', async () => {
      prismaMock.attachment.count.mockResolvedValueOnce(1); // one of two invalid

      await expect(
        service.create('t1', 'author', {
          body: 'sneaky',
          attachmentIds: ['att1', 'someone-elses'],
        }),
      ).rejects.toThrow('One or more attachments are invalid');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update (author-only edit)', () => {
    const existing = {
      id: 'c1',
      authorId: 'author',
      task: { id: 't1', projectId: 'p1' },
    };

    it('rejects edits from anyone but the author', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...existing });
      await expect(
        service.update('c1', 'someone-else', { body: 'hijack' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('only notifies newly mentioned users on edit', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...existing });
      // "member" was already pinged when the comment was first posted.
      prismaMock.notification.findMany.mockResolvedValueOnce([{ userId: 'member' }]);
      projectsMock.memberIds.mockResolvedValue(['author', 'member', 'late-add']);
      txMock.comment.update.mockResolvedValueOnce({ id: 'c1', body: 'edited' });

      await service.update('c1', 'author', {
        body: 'edited @Member @Late',
        mentions: ['member', 'late-add'],
      });

      expect(notificationsMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({ recipientIds: ['late-add'] }),
        txMock,
      );
      expect(realtimeMock.emitCommentUpdated).toHaveBeenCalled();
    });
  });

  // IDOR/permission matrix for deletion: author and project ADMIN+ may
  // delete, anyone else must get a 403 even when they can read the project.
  describe('remove', () => {
    const comment = {
      id: 'c1',
      authorId: 'author',
      attachments: [{ id: 'att1', key: 'tasks/t1/file.png' }],
      task: { id: 't1', projectId: 'p1' },
    };

    it('rejects a non-author without ADMIN role', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      projectsMock.roleIn.mockResolvedValueOnce('EDITOR');
      await expect(service.remove('c1', 'editor')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });

    it('lets the author delete their own comment and cleans up files', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      await service.remove('c1', 'author');
      expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      // Attached objects are removed from storage best-effort.
      expect(storageMock.deleteObject).toHaveBeenCalledWith('tasks/t1/file.png');
      expect(realtimeMock.emitAttachmentRemoved).toHaveBeenCalledWith('p1', 't1', 'att1');
    });

    it('lets a project ADMIN moderate any comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      projectsMock.roleIn.mockResolvedValueOnce('ADMIN');
      await service.remove('c1', 'admin');
      expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('404s on a missing comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove('nope', 'author')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
