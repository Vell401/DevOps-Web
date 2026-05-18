import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async assertAssigneeExists(assigneeId: string | undefined): Promise<void> {
    if (!assigneeId) return;
    const exists = await this.prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Assignee not found');
  }

  async listByProject(projectId: string, userId: string, query: QueryTasksDto) {
    await this.projects.getOwned(projectId, userId);
    return this.prisma.task.findMany({
      where: {
        projectId,
        status: query.status,
        priority: query.priority,
        assigneeId: query.assigneeId,
      },
      include: { assignee: { select: { id: true, name: true, email: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: true,
        assignee: { select: { id: true, name: true, email: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.project.ownerId !== userId) throw new ForbiddenException();
    return task;
  }

  async create(projectId: string, userId: string, dto: CreateTaskDto) {
    await this.projects.getOwned(projectId, userId);
    await this.assertAssigneeExists(dto.assigneeId);
    return this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        projectId,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateTaskDto) {
    await this.get(id, userId);
    await this.assertAssigneeExists(dto.assigneeId);
    return this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.get(id, userId);
    await this.prisma.task.delete({ where: { id } });
  }
}
