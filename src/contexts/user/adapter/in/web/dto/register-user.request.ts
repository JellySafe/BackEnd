import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { REGISTRABLE_ROLES, RegistrableRole } from '../../../../domain/user-enums';

/**
 * AUTH-001 POST /admin/auth/register 요청.
 * role 은 operator|admin 만 허용한다(public 은 익명 사용자).
 */
export class RegisterUserRequest {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(REGISTRABLE_ROLES as readonly string[])
  role!: RegistrableRole;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  managedRegion?: string;
}
