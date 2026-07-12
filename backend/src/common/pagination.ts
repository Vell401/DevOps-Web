import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Hard ceiling for every paginated list endpoint. */
export const MAX_PAGE_SIZE = 100;

/**
 * Cursor pagination query, shared by list endpoints. `cursor` is the id of the
 * last item of the previous page; results continue strictly after it. Cursor
 * (not offset) pagination keeps pages stable while rows are inserted/deleted
 * between requests — important for live boards and activity feeds.
 */
export class PageQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build a page from a `take: limit + 1` query: the sentinel row only signals
 * that another page exists and is never returned to the client.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? items[items.length - 1].id : null,
  };
}
