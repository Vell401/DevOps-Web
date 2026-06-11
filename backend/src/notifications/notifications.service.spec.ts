import { Test } from '@nestjs/testing';

import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const prismaMock = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  describe('createMentions', () => {
    it('creates one MENTIONED row per recipient', async () => {
      prismaMock.notification.create
        .mockResolvedValueOnce({ id: 'n1', userId: 'u1' })
        .mockResolvedValueOnce({ id: 'n2', userId: 'u2' });

      const rows = await service.createMentions({
        recipientIds: ['u1', 'u2'],
        actorId: 'author',
        taskId: 't1',
        commentId: 'c1',
      });

      expect(rows.map((r) => r.id)).toEqual(['n1', 'n2']);
      expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
      expect(prismaMock.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            userId: 'u1',
            actorId: 'author',
            type: 'MENTIONED',
            taskId: 't1',
            commentId: 'c1',
          },
        }),
      );
    });

    it('uses the provided transaction client', async () => {
      const txMock = { notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) } };
      await service.createMentions(
        { recipientIds: ['u1'], actorId: 'a', taskId: 't', commentId: 'c' },
        txMock as never,
      );
      expect(txMock.notification.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('list (pagination)', () => {
    it('caps the page and returns a cursor when more rows exist', async () => {
      prismaMock.notification.findMany.mockResolvedValueOnce([
        { id: 'n1' },
        { id: 'n2' },
        { id: 'n3' },
      ]);

      const page = await service.list('u1', { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe('n2');
      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' }, take: 3 }),
      );
    });
  });

  describe('read tracking', () => {
    it('markRead only touches the caller’s own unread rows', async () => {
      prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 1 });

      const updated = await service.markRead('u1', ['n1', 'n2']);

      expect(updated).toBe(1);
      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['n1', 'n2'] }, userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('markRead is a no-op for an empty id list', async () => {
      await expect(service.markRead('u1', [])).resolves.toBe(0);
      expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
    });

    it('markAllRead clears every unread row of the user', async () => {
      prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 7 });

      await expect(service.markAllRead('u1')).resolves.toBe(7);
      expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });
});
