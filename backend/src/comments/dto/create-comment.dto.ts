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
}
