import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityType, Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ActivityService } from '../activity/activity.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';

const TASK_INCLUDE = {
  assignee: {
    select: { id: true, name: true, email: true, avatarColor: true },
  },
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

  private async assertAssigneeExists(assigneeId: string | undefined | null): Promise<void> {
    if (!assigneeId) return;
    const exists = await this.prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Assignee not found');
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
      assigneeId: query.assigneeId,
    };

    if (query.q) {
      where.title = { contains: query.q, mode: 'insensitive' };
    }
    if (query.labelIds && query.labelIds.length) {
      where.labels = { some: { id: { in: query.labelIds } } };
    }
    if (query.topLevel === 'true') {
      where.parentId = null;
    }

    return this.prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...TASK_INCLUDE,
        subtasks: {
          include: {
            assignee: {
              select: { id: true, name: true, email: true, avatarColor: true },
            },
            labels: true,
            _count: { select: { subtasks: true, comments: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        project: {
          select: { id: true, key: true, name: true, ownerId: true },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.project.ownerId !== userId) {
      // Membership: any user with at least one assigned task in this project
      // can read every task in it. Matches projects.service.getAccessible.
      const isMember = await this.prisma.task.findFirst({
        where: { projectId: task.projectId, assigneeId: userId },
        select: { id: true },
      });
      if (!isMember) throw new ForbiddenException();
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
    await this.assertAssigneeExists(dto.assigneeId);
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
          assigneeId: dto.assigneeId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          parentId: dto.parentId,
          projectId,
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
    // New assignment may add the project to that user's sidebar.
    await this.notifyProjectMembers(projectId, [dto.assigneeId, userId]);
    return result;
  }

  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const before = await this.get(id, userId);

    if (dto.assigneeId) await this.assertAssigneeExists(dto.assigneeId);
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
    if (dto.assigneeId !== undefined) {
      data.assignee = dto.assigneeId
        ? { connect: { id: dto.assigneeId } }
        : { disconnect: true };
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
      const after = await tx.task.update({
        where: { id },
        data,
        include: TASK_INCLUDE,
      });

      if (dto.status !== undefined && before.status !== after.status) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.STATUS_CHANGED,
            fromValue: before.status,
            toValue: after.status,
          },
          tx,
        );
      }
      if (dto.priority !== undefined && before.priority !== after.priority) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.PRIORITY_CHANGED,
            fromValue: before.priority,
            toValue: after.priority,
          },
          tx,
        );
      }
      if (dto.assigneeId !== undefined && before.assigneeId !== after.assigneeId) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.ASSIGNEE_CHANGED,
            fromValue: before.assigneeId,
            toValue: after.assigneeId,
          },
          tx,
        );
      }
      if (dto.title !== undefined && before.title !== after.title) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.TITLE_CHANGED,
            fromValue: before.title,
            toValue: after.title,
          },
          tx,
        );
      }
      if (dto.description !== undefined && before.description !== after.description) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.DESCRIPTION_CHANGED,
          },
          tx,
        );
      }
      if (dto.dueDate !== undefined && (before.dueDate?.toISOString() ?? null) !== (after.dueDate?.toISOString() ?? null)) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.DUE_DATE_CHANGED,
            fromValue: before.dueDate?.toISOString() ?? null,
            toValue: after.dueDate?.toISOString() ?? null,
          },
          tx,
        );
      }
      if (dto.parentId !== undefined && before.parentId !== after.parentId) {
        await this.activity.log(
          {
            taskId: id,
            actorId: userId,
            type: ActivityType.PARENT_CHANGED,
            fromValue: before.parentId,
            toValue: after.parentId,
          },
          tx,
        );
      }
      if (dto.labelIds) {
        const beforeIds = new Set(before.labels.map((l) => l.id));
        const afterIds = new Set(after.labels.map((l) => l.id));
        const added = [...afterIds].filter((x) => !beforeIds.has(x));
        const removed = [...beforeIds].filter((x) => !afterIds.has(x));
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
    // Assignment may have moved between users → notify old + new + actor.
    await this.notifyProjectMembers(before.projectId, [
      before.assigneeId,
      dto.assigneeId,
      userId,
    ]);
    return result;
  }

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.get(id, userId);
    await this.prisma.task.delete({ where: { id } });
    await this.projects.syncClosureState(task.projectId);
    this.realtime.emitTaskDeleted(task.projectId, id);
    await this.notifyProjectMembers(task.projectId, [task.assigneeId, userId]);
  }
}
