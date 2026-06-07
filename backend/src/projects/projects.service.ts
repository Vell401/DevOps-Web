import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /**
   * Membership rule: a user has access to a project if they OWN it OR they are
   * the assignee of at least one task in it. The second condition turns task
   * assignment into implicit project membership — exactly what users expect
   * ("admin assigned me a task, so I see the project").
   */
  private accessibleWhere(userId: string): Prisma.ProjectWhereInput {
    return {
      OR: [
        { ownerId: userId },
        { tasks: { some: { assigneeId: userId } } },
      ],
    };
  }

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
        ...this.accessibleWhere(userId),
        closedAt: opts.closed ? { not: null } : null,
      },
      orderBy: opts.closed ? { closedAt: 'desc' } : { createdAt: 'desc' },
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

  /** Owner-only: project lifecycle (rename / close / reopen / delete). */
  async getOwned(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== userId) throw new ForbiddenException();
    return project;
  }

  /** Member-access: owner or anyone with at least one assigned task in it. */
  async getAccessible(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId === userId) return project;
    const isMember = await this.prisma.task.findFirst({
      where: { projectId: id, assigneeId: userId },
      select: { id: true },
    });
    if (!isMember) throw new ForbiddenException();
    return project;
  }

  async assertAccessible(id: string, userId: string): Promise<void> {
    await this.getAccessible(id, userId);
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
      return project; // already closed, idempotent
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

  /**
   * After any task mutation, reconcile the project's closedAt state:
   *   - every task DONE        → auto-close
   *   - any non-DONE task in a closed project → auto-reopen
   *   - zero tasks             → keep open (empty project ≠ "closed")
   * Returns the transition kind so callers can decide whether to broadcast.
   */
  async syncClosureState(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<'closed' | 'reopened' | 'unchanged'> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { closedAt: true },
    });
    if (!project) return 'unchanged';

    const [total, unfinished] = await Promise.all([
      client.task.count({ where: { projectId } }),
      client.task.count({ where: { projectId, status: { not: 'DONE' } } }),
    ]);

    const shouldBeClosed = total > 0 && unfinished === 0;
    const isClosed = project.closedAt !== null;

    if (shouldBeClosed && !isClosed) {
      await client.project.update({
        where: { id: projectId },
        data: { closedAt: new Date() },
      });
      return 'closed';
    }
    if (!shouldBeClosed && isClosed) {
      await client.project.update({
        where: { id: projectId },
        data: { closedAt: null },
      });
      return 'reopened';
    }
    return 'unchanged';
  }

  /**
   * Distinct user IDs that should be notified when a project's state changes:
   * the owner plus every distinct task assignee currently in the project.
   */
  async memberIds(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) return [];
    const assignees = await this.prisma.task.findMany({
      where: { projectId, assigneeId: { not: null } },
      select: { assigneeId: true },
      distinct: ['assigneeId'],
    });
    const ids = new Set<string>([project.ownerId]);
    for (const a of assignees) if (a.assigneeId) ids.add(a.assigneeId);
    return Array.from(ids);
  }

  async remove(id: string, userId: string) {
    await this.getOwned(id, userId);
    await this.prisma.project.delete({ where: { id } });
  }
}
