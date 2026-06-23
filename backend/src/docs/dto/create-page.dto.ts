import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** Parent page for nesting; omitted/undefined = top level of the space. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;
}
