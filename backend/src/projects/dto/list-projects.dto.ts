import { IsBooleanString, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../common/pagination';

export class ListProjectsDto extends PageQueryDto {
  @IsOptional()
  @IsBooleanString()
  closed?: string;
}
