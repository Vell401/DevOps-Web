import { ActivityType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

/** Filters for the global activity inbox (`GET /activity`). */
export class QueryActivityDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;
}
