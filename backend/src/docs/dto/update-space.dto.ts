import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSpaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;
}
