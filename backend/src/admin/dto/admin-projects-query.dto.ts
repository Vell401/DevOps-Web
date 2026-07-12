import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

import { PageQueryDto } from '../../common/pagination';

/** Query for GET /admin/projects: cursor + limit (inherited) plus an optional
 *  open/closed filter and a name/key search. */
export class AdminProjectsQueryDto extends PageQueryDto {
  // 'true' → closed only, 'false' → open only, omitted → all. Guard the absent
  // case so it stays undefined rather than being coerced to false.
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  closed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
