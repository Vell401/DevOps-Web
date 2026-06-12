import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ActivityType, NotificationType } from '@prisma/client';

import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    user: { findMany: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  const projectsMock = {
    getAccessible: jest.fn(),
    assertRole: jest.fn(),
    roleIn: jest.fn(),
    ensureMember: jest.fn(),
    assertNotClosed: jest.fn(),
    syncClosureState: jest.fn().mockResolvedValue('unchanged'),
    memberIds: jest.fn().mockResolvedValue([]),
  };
  const activityMock = { log: jest.fn().mockResolvedValue({ id: 'a1' }) };
  const notificationsMock = { notify: jest.fn().mockResolvedValue([]) };
  const realtimeMock = {
    emitTaskUpserted: jest.fn(),
    emitTaskDeleted: jest.fn(),
    emitNotification: jest.fn(),
    emitProjectsChangedForUsers: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks does NOT drop queued mockResolvedValueOnce values; reset
    // the tx mocks fully so a failed test can't leak its queue into the next.
    txMock.task.findUnique.mockReset();
    txMock.task.update.mockReset();
    projectsMock.syncClosureState.mockResolvedValue('unchanged');
    projectsMock.memberIds.mockResolvedValue([]);
    notificationsMock.notify.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectsService, useValue: projectsMock },
        { provide: ActivityService, useValue: activityMock },
        { provide: NotificationsService, useValue: notificationsMock },
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

  describe('update (roles + concurrent PATCH regression)', () => {
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
      project: { id: 'p1', key: 'PRJ', name: 'Project', ownerId: 'u1' },
    };

    it('logs a status diff computed from the in-transaction read', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      projectsMock.roleIn.mockResolvedValue('OWNER');
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
      projectsMock.roleIn.mockResolvedValue('OWNER');
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

    it('blocks VIEWERs from any modification, even status', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      projectsMock.roleIn.mockResolvedValue('VIEWER');

      await expect(
        service.update('t1', 'viewer', { status: 'IN_PROGRESS' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('auto-adds new assignees as members and notifies them', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      prismaMock.user.findMany.mockResolvedValueOnce([
        { id: 'newbie' },
        { id: 'actor' },
      ]);
      projectsMock.roleIn.mockResolvedValue('EDITOR');
      txMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      txMock.task.update.mockResolvedValueOnce({
        ...outerRead,
        assignees: [{ id: 'newbie' }, { id: 'actor' }],
      });
      notificationsMock.notify.mockResolvedValueOnce([
        { id: 'n1', userId: 'newbie' },
      ]);

      await service.update('t1', 'actor', { assigneeIds: ['newbie', 'actor'] });

      expect(projectsMock.ensureMember).toHaveBeenCalledWith('p1', 'newbie', txMock);
      expect(projectsMock.ensureMember).toHaveBeenCalledWith('p1', 'actor', txMock);
      // The actor never gets notified about their own action.
      expect(notificationsMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['newbie'],
          type: NotificationType.ASSIGNED,
          actorId: 'actor',
        }),
        txMock,
      );
      expect(realtimeMock.emitNotification).toHaveBeenCalledWith('newbie', {
        id: 'n1',
        userId: 'newbie',
      });
    });

    it('notifies assignees (minus the actor) about status changes', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({ ...outerRead });
      projectsMock.roleIn.mockResolvedValue('EDITOR');
      txMock.task.findUnique.mockResolvedValueOnce({
        ...outerRead,
        assignees: [{ id: 'assignee' }, { id: 'actor' }],
      });
      txMock.task.update.mockResolvedValueOnce({
        ...outerRead,
        status: 'DONE',
        assignees: [{ id: 'assignee' }, { id: 'actor' }],
      });

      await service.update('t1', 'actor', { status: 'DONE' });

      expect(notificationsMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientIds: ['assignee'],
          type: NotificationType.TASK_STATUS_CHANGED,
        }),
        txMock,
      );
    });
  });

  describe('remove', () => {
    it('requires ADMIN+ (editors cannot delete)', async () => {
      prismaMock.task.findUnique.mockResolvedValueOnce({
        id: 't1',
        projectId: 'p1',
        assignees: [],
        project: { id: 'p1', ownerId: 'owner' },
      });
      projectsMock.roleIn.mockResolvedValue('EDITOR');
      projectsMock.assertRole.mockRejectedValueOnce(new ForbiddenException());

      await expect(service.remove('t1', 'editor')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prismaMock.task.delete).not.toHaveBeenCalled();
    });
  });
});
