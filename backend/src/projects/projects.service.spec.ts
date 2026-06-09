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
});
