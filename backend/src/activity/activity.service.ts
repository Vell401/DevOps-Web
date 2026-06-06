import { Injectable } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityLogInput {
  taskId: string;
  actorId: string;
  type: ActivityType;
  fromValue?: string | null;
  toValue?: string | null;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    input: ActivityLogInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const client = tx ?? this.prisma;
    return client.activity.create({
      data: {
        taskId: input.taskId,
        actorId: input.actorId,
        type: input.type,
        fromValue: input.fromValue ?? null,
        toValue: input.toValue ?? null,
      },
      select: { id: true },
    });
  }

  listForTask(taskId: string, limit = 100) {
    return this.prisma.activity.findMany({
      where: { taskId },
      include: {
        actor: { select: { id: true, name: true, email: true, avatarColor: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listForProject(projectId: string, limit = 50) {
    return this.prisma.activity.findMany({
      where: { task: { projectId } },
      include: {
        actor: { select: { id: true, name: true, email: true, avatarColor: true } },
        task: { select: { id: true, title: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
