import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const FALLBACK_KEY = 'PRJ';

const USER_LITE = {
  select: { id: true, name: true, email: true, avatarColor: true },
} as const;

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Membership rule: a user has access to a project if any of these is true:
   *   - they OWN it
   *   - they are an explicit member (added by the owner via the members API)
   *   - they are an assignee of at least one task in it (implicit membership)
   */
  private accessibleWhere(userId: string): Prisma.ProjectWhereInput {
    return {
      OR: [
        { ownerId: userId },
        { members: { some: { id: userId } } },
        { tasks: { some: { assignees: { some: { id: userId } } } } },
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
      include: {
        _count: { select: { tasks: true } },
        // Owner + explicit members power the "people" avatar stack on the
        // project cards. Implicit task-assignees are intentionally not loaded
        // here — that would require scanning every task per project.
        owner: USER_LITE,
        members: { ...USER_LITE, orderBy: { name: 'asc' } },
      },
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

  /** Member-access: owner, explicit member, or any task-assignee in the project. */
  async getAccessible(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { members: { select: { id: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId === userId) {
      const { members: _m, ...rest } = project;
      return rest;
    }
    if (project.members.some((m) => m.id === userId)) {
      const { members: _m, ...rest } = project;
      return rest;
    }
    const isAssignee = await this.prisma.task.findFirst({
      where: {
        projectId: id,
        assignees: { some: { id: userId } },
      },
      select: { id: true },
    });
    if (!isAssignee) throw new ForbiddenException();
    const { members: _m, ...rest } = project;
    return rest;
  }

  async assertAccessible(id: string, userId: string): Promise<void> {
    await this.getAccessible(id, userId);
  }

  /**
   * Reject any mutation on a closed project. Owners must explicitly `reopen()`
   * the project before making changes. Called from every mutating path in
   * tasks/comments/labels/projects services.
   */
  async assertNotClosed(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { closedAt: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.closedAt) {
      throw new BadRequestException(
        'Project is closed; reopen it to make changes',
      );
    }
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
    await this.assertNotClosed(id);
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
   *   - every task DONE → auto-close
   *   - zero tasks      → keep open (empty project ≠ "closed")
   *
   * Auto-reopen was intentionally removed: closed projects are immutable
   * (assertNotClosed in every mutation), so the only way to leave the closed
   * state is through the explicit `reopen()` endpoint by the owner.
   *
   * Returns the transition kind so callers can decide whether to broadcast.
   */
  async syncClosureState(
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<'closed' | 'unchanged'> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { closedAt: true },
    });
    if (!project) return 'unchanged';
    if (project.closedAt) return 'unchanged';

    const [total, unfinished] = await Promise.all([
      client.task.count({ where: { projectId } }),
      client.task.count({ where: { projectId, status: { not: 'DONE' } } }),
    ]);

    if (total > 0 && unfinished === 0) {
      await client.project.update({
        where: { id: projectId },
        data: { closedAt: new Date() },
      });
      return 'closed';
    }
    return 'unchanged';
  }

  /**
   * Distinct user IDs that should be notified when a project's state changes:
   * the owner plus every explicit member plus every distinct task assignee
   * currently in the project.
   */
  async memberIds(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        members: { select: { id: true } },
        tasks: {
          where: { assignees: { some: {} } },
          select: { assignees: { select: { id: true } } },
        },
      },
    });
    if (!project) return [];
    const ids = new Set<string>([project.ownerId]);
    for (const m of project.members) ids.add(m.id);
    for (const t of project.tasks) {
      for (const a of t.assignees) ids.add(a.id);
    }
    return Array.from(ids);
  }

  // ----------------- Explicit project members management -----------------

  async listMembers(projectId: string, userId: string) {
    await this.assertAccessible(projectId, userId);
    return this.prisma.user.findMany({
      where: { memberProjects: { some: { id: projectId } } },
      select: {
        id: true,
        name: true,
        email: true,
        avatarColor: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async addMember(projectId: string, userId: string, memberId: string) {
    const project = await this.getOwned(projectId, userId);
    await this.assertNotClosed(projectId);
    if (memberId === project.ownerId) {
      throw new BadRequestException('Owner is already a member by default');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.project.update({
      where: { id: projectId },
      data: { members: { connect: { id: memberId } } },
    });
    // The new member's sidebar/projects list (and everyone else's view) should
    // reflect the change live, without a manual reload. memberIds now includes
    // the freshly connected member.
    this.realtime.emitProjectsChangedForUsers(await this.memberIds(projectId));
    return this.listMembers(projectId, userId);
  }

  async removeMember(projectId: string, userId: string, memberId: string) {
    await this.getOwned(projectId, userId);
    await this.assertNotClosed(projectId);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { members: { disconnect: { id: memberId } } },
    });
    // Notify the remaining participants plus the removed user, whose sidebar
    // should drop the project (unless they remain an implicit task-assignee).
    this.realtime.emitProjectsChangedForUsers([
      ...(await this.memberIds(projectId)),
      memberId,
    ]);
    return this.listMembers(projectId, userId);
  }

  async remove(id: string, userId: string) {
    await this.getOwned(id, userId);
    await this.prisma.project.delete({ where: { id } });
  }
}
