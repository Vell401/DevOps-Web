import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        avatarColor: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            projects: true,
            assignedTasks: true,
            comments: true,
          },
        },
      },
    });
    return users.map((u) => ({
      ...u,
      stats: {
        projects: u._count.projects,
        tasks: u._count.assignedTasks,
        comments: u._count.comments,
      },
      _count: undefined,
    }));
  }

  async updateUser(
    targetId: string,
    actingUserId: string,
    dto: AdminUpdateUserDto,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found');

    // Safety net: don't let the last admin demote themselves.
    if (
      dto.isAdmin === false &&
      target.isAdmin &&
      target.id === actingUserId
    ) {
      const adminCount = await this.prisma.user.count({
        where: { isAdmin: true },
      });
      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot demote the last admin — promote another user first',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const data: {
        name?: string;
        isAdmin?: boolean;
        passwordHash?: string;
      } = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.isAdmin !== undefined) data.isAdmin = dto.isAdmin;
      if (dto.newPassword) {
        data.passwordHash = await bcrypt.hash(dto.newPassword, 12);
        // Revoke all refresh tokens — the user must log in again.
        await tx.refreshToken.deleteMany({ where: { userId: targetId } });
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          avatarColor: true,
          isAdmin: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return updated;
    });
  }

  async deleteUser(targetId: string, actingUserId: string): Promise<void> {
    if (targetId === actingUserId) {
      throw new BadRequestException(
        'Cannot delete your own account from the admin panel',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found');

    if (target.isAdmin) {
      const adminCount = await this.prisma.user.count({
        where: { isAdmin: true },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last admin');
      }
    }

    await this.prisma.user.delete({ where: { id: targetId } });
  }

  async stats() {
    const [users, admins, projects, tasks, comments, recentSignups] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isAdmin: true } }),
        this.prisma.project.count(),
        this.prisma.task.count(),
        this.prisma.comment.count(),
        this.prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            email: true,
            name: true,
            avatarColor: true,
            createdAt: true,
          },
        }),
      ]);

    const tasksByStatus = await this.prisma.task.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return {
      users,
      admins,
      projects,
      tasks,
      comments,
      tasksByStatus: tasksByStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      recentSignups,
    };
  }
}
