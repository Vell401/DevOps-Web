import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { MAX_PAGE_SIZE, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const FALLBACK_KEY = 'PRJ';

const USER_LITE = {
  select: { id: true, name: true, email: true, avatarColor: true, avatarKey: true },
} as const;

/** A user's effective role in a project. Ownership outranks every member role. */
export type EffectiveRole = ProjectRole | 'OWNER';

const ROLE_RANK: Record<EffectiveRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function roleAtLeast(
  role: EffectiveRole | null,
  min: EffectiveRole,
): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

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
   * Access rule: a user can see a project if they OWN it or have a member row
   * (any role). Task assignees are auto-added as EDITOR members on assignment,
   * so there is no separate "implicit membership" path any more.
   */
  private accessibleWhere(userId: string): Prisma.ProjectWhereInput {
    return {
      OR: [{ ownerId: userId }, { memberships: { some: { userId } } }],
    };
  }

  /**
   * Effective role of a user in a project: OWNER, the member-row role, or
   * null when they have no access. Throws 404 when the project is missing.
   */
  async roleIn(
    projectId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EffectiveRole | null> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId === userId) return 'OWNER';
    const member = await client.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  /** Throws 403 unless the user's effective role is at least `min`. */
  async assertRole(
    projectId: string,
    userId: string,
    min: EffectiveRole,
  ): Promise<EffectiveRole> {
    const role = await this.roleIn(projectId, userId);
    if (!roleAtLeast(role, min)) throw new ForbiddenException();
    return role as EffectiveRole;
  }

  /**
   * Auto-add on assignment: assigning a task to a non-member creates an
   * EDITOR membership so the assignee sees the project and can work in it.
   * Existing rows keep their role (an upsert with a no-op update).
   */
  async ensureMember(
    projectId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project || project.ownerId === userId) return;
    await client.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      update: {},
      create: { projectId, userId, role: ProjectRole.EDITOR },
    });
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

  async list(
    userId: string,
    opts: { closed?: boolean; cursor?: string; limit?: number } = {},
  ) {
    // Cursor pagination (id appended as a unique tiebreaker — created/closed
    // timestamps can collide) keeps the per-request cost bounded; the DONE
    // aggregate below then only runs for the current page.
    const limit = opts.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.project.findMany({
      where: {
        ...this.accessibleWhere(userId),
        closedAt: opts.closed ? { not: null } : null,
      },
      orderBy: opts.closed
        ? [{ closedAt: 'desc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        _count: { select: { tasks: true } },
        // Owner + members power the "people" avatar stack on project cards.
        owner: USER_LITE,
        memberships: {
          include: { user: USER_LITE },
          orderBy: { user: { name: 'asc' } },
        },
      },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, limit);
    if (!page.items.length) return { items: [], nextCursor: page.nextCursor };
    const done = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: page.items.map((p) => p.id) }, status: 'DONE' },
      _count: { _all: true },
    });
    const doneByProject = new Map(done.map((d) => [d.projectId, d._count._all]));
    return {
      items: page.items.map(({ memberships, ...p }) => ({
        ...p,
        members: memberships.map((m) => m.user),
        stats: {
          total: p._count.tasks,
          done: doneByProject.get(p.id) ?? 0,
        },
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Owner-only: project deletion (and anything not delegated to ADMINs). */
  async getOwned(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.ownerId !== userId) throw new ForbiddenException();
    return project;
  }

  /** Any role: returns the project plus the caller's effective role. */
  async getAccessible(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    let myRole: EffectiveRole | null = null;
    if (project.ownerId === userId) {
      myRole = 'OWNER';
    } else {
      const member = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: id, userId } },
        select: { role: true },
      });
      myRole = member?.role ?? null;
    }
    if (!myRole) throw new ForbiddenException();
    return { ...project, myRole };
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
    await this.assertRole(id, userId, 'ADMIN');
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
    await this.assertRole(id, userId, 'ADMIN');
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
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
    await this.assertRole(id, userId, 'ADMIN');
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
   * state is through the explicit `reopen()` endpoint.
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
   * the owner plus every member (assignees are members by the auto-add rule).
   */
  async memberIds(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerId: true,
        memberships: { select: { userId: true } },
      },
    });
    if (!project) return [];
    const ids = new Set<string>([project.ownerId]);
    for (const m of project.memberships) ids.add(m.userId);
    return Array.from(ids);
  }

  // ----------------- Members & roles management -----------------

  async listMembers(projectId: string, userId: string) {
    await this.assertAccessible(projectId, userId);
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: USER_LITE },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((m) => ({ ...m.user, role: m.role }));
  }

  async addMember(
    projectId: string,
    userId: string,
    memberId: string,
    role: ProjectRole = ProjectRole.EDITOR,
  ) {
    const project = await this.getAccessible(projectId, userId);
    if (!roleAtLeast(project.myRole, 'ADMIN')) throw new ForbiddenException();
    await this.assertNotClosed(projectId);
    if (memberId === project.ownerId) {
      throw new BadRequestException('Owner is already a member by default');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: memberId } },
      update: { role },
      create: { projectId, userId: memberId, role },
    });
    // The new member's sidebar/projects list (and everyone else's view) should
    // reflect the change live, without a manual reload.
    this.realtime.emitProjectsChangedForUsers(await this.memberIds(projectId));
    return this.listMembers(projectId, userId);
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    memberId: string,
    role: ProjectRole,
  ) {
    await this.assertRole(projectId, userId, 'ADMIN');
    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: memberId } },
      select: { userId: true },
    });
    if (!existing) throw new NotFoundException('Member not found');
    await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberId } },
      data: { role },
    });
    this.realtime.emitProjectsChangedForUsers(await this.memberIds(projectId));
    return this.listMembers(projectId, userId);
  }

  async removeMember(projectId: string, userId: string, memberId: string) {
    await this.assertRole(projectId, userId, 'ADMIN');
    await this.assertNotClosed(projectId);
    await this.prisma.projectMember.deleteMany({
      where: { projectId, userId: memberId },
    });
    // Notify the remaining participants plus the removed user, whose sidebar
    // should drop the project.
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
