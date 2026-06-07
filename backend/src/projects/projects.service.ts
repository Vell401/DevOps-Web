import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const FALLBACK_KEY = 'PRJ';

function deriveKeyBase(name: string): string {
  const cleaned = name.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const initials = words.slice(0, 4).map((w) => w[0]).join('');
    if (initials.length >= 2) return initials;
  }
  if (words.length === 1) {
    const trimmed = words[0].slice(0, 4);
    if (trimmed.length >= 2) return trimmed;
  }
  return FALLBACK_KEY;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private async makeUniqueKey(name: string): Promise<string> {
    const base = deriveKeyBase(name);
    for (let i = 0; i < 1000; i++) {
      const candidate = i === 0 ? base : `${base}${i}`;
      const exists = await this.prisma.project.findUnique({
        where: { key: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `${base}${Date.now().toString(36).toUpperCase()}`;
  }

  async list(userId: string, opts: { closed?: boolean } = {}) {
    const projects = await this.prisma.project.findMany({
      where: {
        ownerId: userId,
        closedAt: opts.closed ? { not: null } : null,
      },
      orderBy: opts.closed
        ? { closedAt: 'desc' }
        : { createdAt: 'desc' },
      include: { _count: { select: { tasks: true } } },
    });
    if (!projects.length) return [];
    const done = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projects.map((p) => p.id) }, status: 'DONE' },
      _count: { _all: true },
    });
    const doneByProject = new Map(done.map((d) => [d.projectId, d._count._all]));
    return projects.map((p) => ({
      ...p,
      stats: {
        total: p._count.tasks,
        done: doneByProject.get(p.id) ?? 0,
      },
    }));
  }

  async getOwned(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== userId) throw new ForbiddenException();
    return project;
  }

  async create(userId: string, dto: CreateProjectDto) {
    const key = await this.makeUniqueKey(dto.name);
    return this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        description: dto.description,
        ownerId: userId,
        key,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    await this.getOwned(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description: dto.description,
      },
    });
  }

  async close(id: string, userId: string) {
    const project = await this.getOwned(id, userId);
    if (project.closedAt) {
      // Idempotent: already closed.
      return project;
    }
    const unfinished = await this.prisma.task.count({
      where: { projectId: id, status: { not: 'DONE' } },
    });
    if (unfinished > 0) {
      throw new BadRequestException(
        `Cannot close: ${unfinished} unfinished task${unfinished === 1 ? '' : 's'} remain`,
      );
    }
    return this.prisma.project.update({
      where: { id },
      data: { closedAt: new Date() },
    });
  }

  async reopen(id: string, userId: string) {
    await this.getOwned(id, userId);
    return this.prisma.project.update({
      where: { id },
      data: { closedAt: null },
    });
  }

  async remove(id: string, userId: string) {
    await this.getOwned(id, userId);
    await this.prisma.project.delete({ where: { id } });
  }
}
