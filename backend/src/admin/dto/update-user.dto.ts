import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  // When true, the user can no longer log in (existing access tokens still work
  // until they expire). Reversible by setting it back to false.
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  // When set, replaces the user's password and revokes all their refresh tokens.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword?: string;
}
