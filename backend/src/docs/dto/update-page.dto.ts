import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  /** Editor block document (opaque JSON array). Stored as-is in DocPage.content. */
  @IsOptional()
  @IsArray()
  content?: unknown[];

  /** Flattened plain text of `content`, sent by the client for search. */
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  contentText?: string;

  /** Move: a UUID re-parents, `null` moves to the space root, omitted = no move.
   *  (@IsOptional skips validation for both null and undefined.) */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsNumber()
  position?: number;
}
