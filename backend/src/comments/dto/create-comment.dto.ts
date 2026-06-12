import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  /**
   * User ids picked via the @-mention autocomplete. The body keeps the
   * human-readable "@Name" text; notification fan-out works off these ids so
   * it never depends on parsing names back out of free text. The server
   * additionally filters to users who can actually access the project.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  mentions?: string[];

  /**
   * Attachments staged in the composer (already uploaded to the task via the
   * regular upload endpoint) that should render inline inside this comment.
   * Validated server-side: same task, uploaded by the author, not yet linked.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];
}

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  mentions?: string[];
}
