import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { MAX_PAGE_SIZE, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';

const USER_LITE = {
  select: { id: true, name: true, email: true, avatarColor: true },
} as const;

const TASK_INCLUDE = {
  assignees: USER_LITE,
  labels: true,
  parent: { select: { id: true, number: true, title: true } },
  _count: { select: { subtasks: true, comments: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async assertUsersExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One or more assignees do not exist');
    }
  }

  private async assertSameProject(
    projectId: string,
    relationName: string,
    targetId: string | undefined | null,
    model: 'task' | 'label',
  ): Promise<void> {
    if (!targetId) return;
    const row =
      model === 'task'
        ? await this.prisma.task.findUnique({
            where: { id: targetId },
            select: { projectId: true },
          })
        : await this.prisma.label.findUnique({
            where: { id: targetId },
            select: { projectId: true },
          });
    if (!row) throw new BadRequestException(`${relationName} not found`);
    if (row.projectId !== projectId)
      throw new BadRequestException(`${relationName} belongs to a different project`);
  }

  private async assertLabelsInProject(projectId: string, labelIds: string[]): Promise<void> {
    if (!labelIds.length) return;
    const found = await this.prisma.label.findMany({
      where: { id: { in: labelIds }, projectId },
      select: { id: true },
    });
    if (found.length !== labelIds.length) {
      throw new BadRequestException('One or more labels are invalid for this project');
    }
  }

  async listByProject(projectId: string, userId: string, query: QueryTasksDto) {
    await this.projects.getAccessible(projectId, userId);

    const where: Prisma.TaskWhereInput = {
      projectId,
      status: query.status,
      priority: query.priority,
    };

    // Filter by a single assignee (UI dropdown picks one user).
    if (query.assigneeId) {
      where.assignees = { some: { id: query.assigneeId } };
    }
    if (query.q) {
      where.title = { contains: query.q, mode: 'insensitive' };
    }
    if (query.labelIds && query.labelIds.length) {
      where.labels = { some: { id: { in: query.labelIds } } };
    }
    if (query.topLevel === 'true') {
      where.parentId = null;
    }

    // Cursor pagination so one huge project can't pull thousands of rows in a
    // single request. `id` is appended as a tiebreaker — the visible sort keys
    // are not unique, and a cursor over non-deterministic order would skip or
    // duplicate rows between pages.
    const limit = query.limit ?? MAX_PAGE_SIZE;
    const rows = await this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [
        { status: 'asc' },
        { position: 'asc' },
        { createdAt: 'desc' },
        { id: 'asc' },
      ],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, limit);
  }

  async get(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...TASK_INCLUDE,
        subtasks: {
          include: {
            assignees: USER_LITE,
            labels: true,
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        project: {
          select: {
            id: true,
            key: true,
            name: true,
            ownerId: true,
            members: { select: { id: true } },
          },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.project.ownerId !== userId) {
      const isExplicitMember = task.project.members.some((m) => m.id === userId);
      if (!isExplicitMember) {
        // Implicit membership via assignment somewhere in the project.
        const isAssignedAnywhere = await this.prisma.task.findFirst({
          where: {
            projectId: task.projectId,
            assignees: { some: { id: userId } },
          },
          select: { id: true },
        });
        if (!isAssignedAnywhere) throw new ForbiddenException();
      }
    }
    return task;
  }

  private async notifyProjectMembers(
    projectId: string,
    extraIds: (string | null | undefined)[] = [],
  ) {
    const members = await this.projects.memberIds(projectId);
    const ids = new Set<string>(members);
    for (const e of extraIds) if (e) ids.add(e);
    this.realtime.emitProjectsChangedForUsers(Array.from(ids));
  }

  async create(projectId: string, userId: string, dto: CreateTaskDto) {
    await this.projects.getAccessible(projectId, userId);
    await this.projects.assertNotClosed(projectId);

    // Permission: members can create tasks but only with themselves as assignee
    // (or unassigned). Owners can assign anyone.
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    const isOwner = project?.ownerId === userId;
    if (!isOwner && dto.assigneeIds && dto.assigneeIds.some((id) => id !== userId)) {
      throw new ForbiddenException(
        'Members can only assign themselves on new tasks',
      );
    }

    const assigneeIds = dto.assigneeIds ?? [];
    await this.assertUsersExist(assigneeIds);
    await this.assertSameProject(projectId, 'Parent task', dto.parentId, 'task');
    if (dto.labelIds?.length) {
      await this.assertLabelsInProject(projectId, dto.labelIds);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: projectId },
        data: { taskCounter: { increment: 1 } },
        select: { taskCounter: true },
      });

      const task = await tx.task.create({
        data: {
          number: project.taskCounter,
          title: dto.title.trim(),
          description: dto.description,
          status: dto.status ?? TaskStatus.TODO,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          position: dto.position ?? 0,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          parentId: dto.parentId,
          projectId,
          assignees: assigneeIds.length
            ? { connect: assigneeIds.map((id) => ({ id })) }
            : undefined,
          labels: dto.labelIds?.length
            ? { connect: dto.labelIds.map((id) => ({ id })) }
            : undefined,
        },
        include: TASK_INCLUDE,
      });

      await this.activity.log(
        { taskId: task.id, actorId: userId, type: ActivityType.CREATED },
        tx,
      );

      return task;
    });

    await this.projects.syncClosureState(projectId);
    this.realtime.emitTaskUpserted(projectId, result);
    await this.notifyProjectMembers(projectId, [...assigneeIds, userId]);
    return result;
  }

  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const before = await this.get(id, userId);
    await this.projects.assertNotClosed(before.projectId);
    const isOwner = before.project.ownerId === userId;

    // Permission: members can only change status and board position.
    // Title, description, priority, assignees, labels, due date, parent are
    // owner-only. This matches the UI: pickers are disabled for non-owners.
    if (!isOwner) {
      const ownerOnly: (keyof UpdateTaskDto)[] = [
        'title',
        'description',
        'priority',
        'dueDate',
        'assigneeIds',
        'parentId',
        'labelIds',
      ];
      for (const k of ownerOnly) {
        if ((dto as Record<string, unknown>)[k as string] !== undefined) {
          throw new ForbiddenException(
            `Only the project owner can change "${String(k)}"`,
          );
        }
      }
    }

    if (dto.assigneeIds) await this.assertUsersExist(dto.assigneeIds);
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) throw new BadRequestException('Task cannot be its own parent');
      await this.assertSameProject(before.projectId, 'Parent task', dto.parentId, 'task');
    }
    if (dto.labelIds) {
      await this.assertLabelsInProject(before.projectId, dto.labelIds);
    }

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.position !== undefined) data.position = dto.position;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.assigneeIds) {
      data.assignees = { set: dto.assigneeIds.map((aid) => ({ id: aid })) };
    }
    if (dto.parentId !== undefined) {
      data.parent = dto.parentId
        ? { connect: { id: dto.parentId } }
        : { disconnect: true };
    }
    if (dto.labelIds) {
      data.labels = { set: dto.labelIds.map((lid) => ({ id: lid })) };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Read `beforeRow` inside the transaction so the activity-log diffs
      // reflect what *this* mutation actually changed. Reading `before` outside
      // the transaction (as we did) meant two concurrent PATCH calls could both
      // see the same stale "before" and write false diffs into Activity.
      const beforeRow = await tx.task.findUnique({
        where: { id },
        include: TASK_INCLUDE,
      });
      if (!beforeRow) throw new NotFoundException('Task not found');

      const after = await tx.task.update({
        where: { id },
        data,
        include: TASK_INCLUDE,
      });

      if (dto.status !== undefined && beforeRow.status !== after.status) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.STATUS_CHANGED,
            fromValue: beforeRow.status,
            toValue: after.status,
          },
          tx,
        );
      }
      if (dto.priority !== undefined && beforeRow.priority !== after.priority) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.PRIORITY_CHANGED,
            fromValue: beforeRow.priority,
            toValue: after.priority,
          },
          tx,
        );
      }
      if (dto.assigneeIds) {
        const beforeIds = new Set(beforeRow.assignees.map((a) => a.id));
        const afterIds = new Set(after.assignees.map((a) => a.id));
        const added = [...afterIds].filter((x) => !beforeIds.has(x));
        const removed = [...beforeIds].filter((x) => !afterIds.has(x));
        for (const uid of added) {
          await this.activity.log(
            {
              taskId: id,
              actorId: userId,
              type: ActivityType.ASSIGNEE_ADDED,
              toValue: uid,
            },
            tx,
          );
        }
        for (const uid of removed) {
          await this.activity.log(
            {
              taskId: id,
              actorId: userId,
              type: ActivityType.ASSIGNEE_REMOVED,
              fromValue: uid,
            },
            tx,
          );
        }
      }
      if (dto.title !== undefined && beforeRow.title !== after.title) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.TITLE_CHANGED,
            fromValue: beforeRow.title,
            toValue: after.title,
          },
          tx,
        );
      }
      if (dto.description !== undefined && beforeRow.description !== after.description) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.DESCRIPTION_CHANGED,
          },
          tx,
        );
      }
      if (
        dto.dueDate !== undefined &&
        (beforeRow.dueDate?.toISOString() ?? null) !== (after.dueDate?.toISOString() ?? null)
      ) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.DUE_DATE_CHANGED,
            fromValue: beforeRow.dueDate?.toISOString() ?? null,
            toValue: after.dueDate?.toISOString() ?? null,
          },
          tx,
        );
      }
      if (dto.parentId !== undefined && beforeRow.parentId !== after.parentId) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.PARENT_CHANGED,
            fromValue: beforeRow.parentId,
            toValue: after.parentId,
          },
          tx,
        );
      }
      if (dto.labelIds) {
        const beforeLabels = new Set(beforeRow.labels.map((l) => l.id));
        const afterLabels = new Set(after.labels.map((l) => l.id));
        const added = [...afterLabels].filter((x) => !beforeLabels.has(x));
        const removed = [...beforeLabels].filter((x) => !afterLabels.has(x));
        for (const labelId of added) {
          await this.activity.log(
            {
              taskId: id,
              actorId: userId,
              type: ActivityType.LABEL_ADDED,
              toValue: labelId,
            },
            tx,
          );
        }
        for (const labelId of removed) {
          await this.activity.log(
            {
              taskId: id,
              actorId: userId,
              type: ActivityType.LABEL_REMOVED,
              fromValue: labelId,
            },
            tx,
          );
        }
      }

      return after;
    });

    await this.projects.syncClosureState(before.projectId);
    this.realtime.emitTaskUpserted(before.projectId, result);
    // Notify old assignees (so the project disappears if they were the only
    // reason it appeared), new assignees, and the actor.
    const oldAssigneeIds = before.assignees.map((a) => a.id);
    const newAssigneeIds = result.assignees.map((a) => a.id);
    await this.notifyProjectMembers(before.projectId, [
      ...oldAssigneeIds,
      ...newAssigneeIds,
      userId,
    ]);
    return result;
  }

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.get(id, userId);
    if (task.project.ownerId !== userId) {
      throw new ForbiddenException('Only the project owner can delete tasks');
    }
    await this.projects.assertNotClosed(task.projectId);
    const formerAssignees = task.assignees.map((a) => a.id);
    await this.prisma.task.delete({ where: { id } });
    await this.projects.syncClosureState(task.projectId);
    this.realtime.emitTaskDeleted(task.projectId, id);
    await this.notifyProjectMembers(task.projectId, [...formerAssignees, userId]);
  }
}
