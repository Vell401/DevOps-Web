import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class MarkReadDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}
