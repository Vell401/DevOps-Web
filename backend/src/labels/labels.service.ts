import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

@Injectable()
export class LabelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string, userId: string) {
    await this.projects.getAccessible(projectId, userId);
    return this.prisma.label.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(projectId: string, userId: string, dto: CreateLabelDto) {
    await this.projects.getAccessible(projectId, userId);
    try {
      return await this.prisma.label.create({
        data: {
          name: dto.name.trim(),
          color: dto.color ?? 'GRAY',
          projectId,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Label with this name already exists');
      }
      throw e;
    }
  }

  async update(id: string, userId: string, dto: UpdateLabelDto) {
    const label = await this.prisma.label.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!label) throw new NotFoundException('Label not found');
    await this.projects.assertAccessible(label.projectId, userId);
    return this.prisma.label.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        color: dto.color,
      },
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const label = await this.prisma.label.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!label) throw new NotFoundException('Label not found');
    await this.projects.assertAccessible(label.projectId, userId);
    await this.prisma.label.delete({ where: { id } });
  }
}
