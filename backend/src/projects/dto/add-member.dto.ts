import { ProjectRole } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  /** Defaults to EDITOR — the everyday collaborator role. */
  @IsOptional()
  @IsEnum(ProjectRole)
  role?: ProjectRole;
}

export class UpdateMemberRoleDto {
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
