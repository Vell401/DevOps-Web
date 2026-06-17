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
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    task: {
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

  // IDOR guard: getAccessible/roleIn is the single access check used by
  // tasks, comments, attachments and realtime — a regression here exposes
  // every project-scoped resource to strangers.
  describe('access & roles', () => {
    const row = { id: 'p1', ownerId: 'owner' };

    it('denies a user with no member row', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      prismaMock.projectMember.findUnique.mockResolvedValueOnce(null);
      await expect(service.getAccessible('p1', 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns the member-row role to a member', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      prismaMock.projectMember.findUnique.mockResolvedValueOnce({ role: 'VIEWER' });
      await expect(service.getAccessible('p1', 'viewer')).resolves.toMatchObject({
        id: 'p1',
        myRole: 'VIEWER',
      });
    });

    it('returns OWNER for the owner without a member lookup', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ...row });
      await expect(service.getAccessible('p1', 'owner')).resolves.toMatchObject({
        myRole: 'OWNER',
      });
      expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
    });

    it('assertRole enforces the hierarchy (VIEWER < EDITOR)', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ ...row });
      prismaMock.projectMember.findUnique.mockResolvedValueOnce({ role: 'VIEWER' });
      await expect(service.assertRole('p1', 'viewer', 'EDITOR')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      prismaMock.projectMember.findUnique.mockResolvedValueOnce({ role: 'ADMIN' });
      await expect(service.assertRole('p1', 'admin', 'EDITOR')).resolves.toBe('ADMIN');
    });

    it('ensureMember auto-adds an EDITOR row but never for the owner', async () => {
      prismaMock.project.findUnique.mockResolvedValueOnce({ ownerId: 'owner' });
      await service.ensureMember('p1', 'owner');
      expect(prismaMock.projectMember.upsert).not.toHaveBeenCalled();

      prismaMock.project.findUnique.mockResolvedValueOnce({ ownerId: 'owner' });
      await service.ensureMember('p1', 'newbie');
      expect(prismaMock.projectMember.upsert).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: 'p1', userId: 'newbie' } },
        update: {},
        create: { projectId: 'p1', userId: 'newbie', role: 'EDITOR' },
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
        memberships: [],
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
