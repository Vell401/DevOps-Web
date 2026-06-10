import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { CommentsService } from './comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivityService } from '../activity/activity.service';
import { ProjectsService } from '../projects/projects.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('CommentsService', () => {
  let service: CommentsService;

  const prismaMock = {
    comment: { findUnique: jest.fn(), delete: jest.fn() },
  };
  const tasksMock = { get: jest.fn() };
  const activityMock = { log: jest.fn() };
  const projectsMock = {
    assertNotClosed: jest.fn(),
    memberIds: jest.fn().mockResolvedValue([]),
  };
  const realtimeMock = {
    emitCommentDeleted: jest.fn(),
    emitProjectsChangedForUsers: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    projectsMock.memberIds.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksService, useValue: tasksMock },
        { provide: ActivityService, useValue: activityMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: RealtimeGateway, useValue: realtimeMock },
      ],
    }).compile();
    service = moduleRef.get(CommentsService);
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
