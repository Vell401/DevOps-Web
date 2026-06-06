import { OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

class UpdateTaskBase extends PartialType(
  OmitType(CreateTaskDto, ['assigneeId', 'parentId', 'dueDate', 'labelIds'] as const),
) {}

export class UpdateTaskDto extends UpdateTaskBase {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  labelIds?: string[];
}
