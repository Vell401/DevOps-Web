import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('ProjectsService', () => {
  let service: ProjectsService;
  const prismaMock = {
    project: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
  };
  const realtimeMock = { emitProjectsChangedForUsers: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RealtimeGateway, useValue: realtimeMock },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  it('returns project when owned by user', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({ id: 'p1', ownerId: 'u1' });
    await expect(service.getOwned('p1', 'u1')).resolves.toEqual({
      id: 'p1',
      ownerId: 'u1',
    });
  });

  it('throws NotFoundException when project missing', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce(null);
    await expect(service.getOwned('p1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when user is not owner', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({ id: 'p1', ownerId: 'u2' });
    await expect(service.getOwned('p1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  // IDOR guard: getAccessible is the single access check used by tasks,
  // comments, attachments and realtime — a regression here exposes every
  // project-scoped resource to strangers.
  describe('getAccessible', () => {
    const row = { id: 'p1', ownerId: 'owner', members: [{ id: 'member' }] };

    it('denies a user who is neither owner, member nor assignee', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      prismaMock.task.findFirst.mockResolvedValueOnce(null);
      await expect(service.getAccessible('p1', 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows an explicit member', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      await expect(service.getAccessible('p1', 'member')).resolves.toMatchObject({
        id: 'p1',
      });
      // Member short-circuits before the assignee lookup.
      expect(prismaMock.task.findFirst).not.toHaveBeenCalled();
    });

    it('allows an implicit member (assigned to a task in the project)', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      prismaMock.task.findFirst.mockResolvedValueOnce({ id: 't1' });
      await expect(service.getAccessible('p1', 'assignee')).resolves.toMatchObject({
        id: 'p1',
      });
    });
  });

  describe('list (pagination)', () => {
    function fakeProject(i: number) {
      return {
        id: `p${i}`,
        ownerId: 'u1',
        _count: { tasks: 0 },
        owner: { id: 'u1' },
        members: [],
      };
    }

    it('caps the page and returns a cursor when more rows exist', async () => {
      // Service asks for limit+1 rows; returning exactly that signals a next page.
      prismaMock.project.findMany.mockResolvedValueOnce(
        Array.from({ length: 3 }, (_, i) => fakeProject(i)),
      );
      prismaMock.task.groupBy.mockResolvedValueOnce([]);

      const page = await service.list('u1', { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe('p1');
      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
    });

    it('returns null cursor on the last page and resumes from a cursor', async () => {
      prismaMock.project.findMany.mockResolvedValueOnce([fakeProject(2)]);
      prismaMock.task.groupBy.mockResolvedValueOnce([]);

      const page = await service.list('u1', { limit: 2, cursor: 'p1' });

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'p1' }, skip: 1 }),
      );
    });
  });
});
