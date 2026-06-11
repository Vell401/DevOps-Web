import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { CommentsService } from './comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { ProjectsService } from '../projects/projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

describe('CommentsService', () => {
  let service: CommentsService;

  const txMock = {
    comment: { create: jest.fn() },
  };
  const prismaMock = {
    comment: { findUnique: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  const tasksMock = { get: jest.fn() };
  const activityMock = { log: jest.fn() };
  const projectsMock = {
    assertNotClosed: jest.fn(),
    memberIds: jest.fn().mockResolvedValue([]),
  };
  const realtimeMock = {
    emitCommentAdded: jest.fn(),
    emitCommentDeleted: jest.fn(),
    emitNotification: jest.fn(),
    emitProjectsChangedForUsers: jest.fn(),
  };
  const notificationsMock = {
    createMentions: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    projectsMock.memberIds.mockResolvedValue([]);
    notificationsMock.createMentions.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksService, useValue: tasksMock },
        { provide: ActivityService, useValue: activityMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: RealtimeGateway, useValue: realtimeMock },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
  });

  describe('create (mentions)', () => {
    beforeEach(() => {
      tasksMock.get.mockResolvedValue({ id: 't1', projectId: 'p1' });
      txMock.comment.create.mockResolvedValue({ id: 'c1', body: 'hi' });
      activityMock.log.mockResolvedValue({ id: 'a1' });
    });

    it('notifies only mentioned project participants, never the author', async () => {
      projectsMock.memberIds.mockResolvedValue(['author', 'member', 'assignee']);
      notificationsMock.createMentions.mockResolvedValueOnce([
        { id: 'n1', userId: 'member' },
      ]);

      await service.create('t1', 'author', {
        body: 'hi @Member @Stranger @Author',
        // author mentions themself, a participant, a duplicate and an outsider
        mentions: ['member', 'member', 'author', 'stranger'],
      });

      expect(notificationsMock.createMentions).toHaveBeenCalledWith(
        {
          recipientIds: ['member'],
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

    it('skips notification fan-out entirely when there are no mentions', async () => {
      projectsMock.memberIds.mockResolvedValue(['author', 'member']);

      await service.create('t1', 'author', { body: 'plain comment' });

      expect(notificationsMock.createMentions).toHaveBeenCalledWith(
        expect.objectContaining({ recipientIds: [] }),
        txMock,
      );
      expect(realtimeMock.emitNotification).not.toHaveBeenCalled();
    });
  });

  // IDOR/permission matrix for deletion: author and project owner may delete,
  // anyone else must get a 403 even when they can read the project.
  describe('remove', () => {
    const comment = {
      id: 'c1',
      authorId: 'author',
      task: { id: 't1', projectId: 'p1', project: { ownerId: 'owner' } },
    };

    it('rejects a user who is neither author nor project owner', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      await expect(service.remove('c1', 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    });

    it('lets the author delete their own comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      await service.remove('c1', 'author');
      expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('lets the project owner moderate any comment', async () => {
      prismaMock.comment.findUnique.mockResolvedValueOnce({ ...comment });
      await service.remove('c1', 'owner');
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
