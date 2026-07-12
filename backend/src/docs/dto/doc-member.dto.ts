import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocRole } from '@prisma/client';

export class AddDocMemberDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsEnum(DocRole)
  role?: DocRole;
}

export class UpdateDocMemberDto {
  @IsEnum(DocRole)
  role!: DocRole;
}
