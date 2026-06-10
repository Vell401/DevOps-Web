import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ActivityType } from '@prisma/client';

import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('TasksService', () => {
  let service: TasksService;

  const txMock = {
    task: { findUnique: jest.fn(), update: jest.fn() },
  };
  const prismaMock = {
    task: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  const projectsMock = {
    getAccessible: jest.fn(),
    assertNotClosed: jest.fn(),
    syncClosureState: jest.fn().mockResolvedValue('unchanged'),
    memberIds: jest.fn().mockResolvedValue([]),
  };
  const activityMock = { log: jest.fn().mockResolvedValue({ id: 'a1' }) };
  const realtimeMock = {
    emitTaskUpserted: jest.fn(),
    emitTaskDeleted: jest.fn(),
    emitProjectsChangedForUsers: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    projectsMock.syncClosureState.mockResolvedValue('unchanged');
    projectsMock.memberIds.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: ActivityService, useValue: activityMock },
        { provide: RealtimeGateway, useValue: realtimeMock },
      ],
    }).compile();
    service = moduleRef.get(TasksService);
  });

  function fakeTaskRow(i: number) {
    return { id: `t${i}`, assignees: [], labels: [] };
  }

  describe('listByProject (pagination)', () => {
    it('caps the page at the limit and exposes a cursor for the rest', async () => {
      projectsMock.getAccessible.mockResolvedValueOnce({ id: 'p1' });
      prismaMock.task.findMany.mockResolvedValueOnce(
        Array.from({ length: 3 }, (_, i) => fakeTaskRow(i)),
      );

      const page = await service.listByProject('p1', 'u1', { limit: 2 });

      expect(page.items.map((t) => t.id)).toEqual(['t0', 't1']);
      expect(page.nextCursor).toBe('t1');
      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('resumes after the cursor and ends with a null cursor', async () => {
      projectsMock.getAccessible.mockResolvedValueOnce({ id: 'p1' });
      prismaMock.task.findMany.mockResolvedValueOnce([fakeTaskRow(2)]);

      const page = await service.listByProject('p1', 'u1', {
        limit: 2,
        cursor: 't1',
      });

      expect(page.nextCursor).toBeNull();
      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 't1' }, skip: 1 }),
      );
    });

    it('refuses to list tasks of an inaccessible project (IDOR)', async () => {
      projectsMock.getAccessible.mockRejectedValueOnce(new ForbiddenException());
      await expect(service.listByProject('p1', 'stranger', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.task.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update (concurrent PATCH regression)', () => {
    // Regression guard for the activity-diff bug: the "before" state used for
    // diffs must be read INSIDE the transaction. If another writer commits
    // between the permission read and our transaction, diffs computed from the
    // stale outer read would log changes that never happened.
    const outerRead = {
      id: 't1',
      projectId: 'p1',
      status: 'TODO',
      priority: 'MEDIUM',
      title: 'Task',
      description: null,
      dueDate: null,
      parentId: null,
      assignees: [],
      labels: [],
      project: { id: 'p1', ownerId: 'u1', members: [] },
    };

    it('logs a status diff computed from the in-transaction read', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      txMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      txMock.task.update.mockResolvedValueOnce({
        ...outerRead,
        status: 'IN_PROGRESS',
      });

      await service.update('t1', 'u1', { status: 'IN_PROGRESS' });

      expect(txMock.task.findUnique).toHaveBeenCalled();
      expect(activityMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          type: ActivityType.STATUS_CHANGED,
          fromValue: 'TODO',
          toValue: 'IN_PROGRESS',
        }),
        txMock,
      );
    });

    it('logs nothing when a concurrent writer already applied the same status', async () => {
      // Outer (stale) read still says TODO…
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      // …but inside the transaction the row is already IN_PROGRESS.
      txMock.task.findUnique.mockResolvedValueOnce({
        ...outerRead,
        status: 'IN_PROGRESS',
      });
      txMock.task.update.mockResolvedValueOnce({
        ...outerRead,
        status: 'IN_PROGRESS',
      });

      await service.update('t1', 'u1', { status: 'IN_PROGRESS' });

      expect(activityMock.log).not.toHaveBeenCalled();
    });

    it('blocks non-owners from changing owner-only fields', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({
        ...outerRead,
        project: { id: 'p1', ownerId: 'someone-else', members: [{ id: 'u1' }] },
      });

      await expect(
        service.update('t1', 'u1', { title: 'hijacked' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
