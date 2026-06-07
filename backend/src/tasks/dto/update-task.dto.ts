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
  OmitType(CreateTaskDto, ['parentId', 'dueDate', 'labelIds', 'assigneeIds'] as const),
) {}

export class UpdateTaskDto extends UpdateTaskBase {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  assigneeIds?: string[];

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
