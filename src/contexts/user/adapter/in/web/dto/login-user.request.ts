import { IsEmail, IsString, MaxLength } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/login 요청.
 */
export class LoginUserRequest {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(100)
  password!: string;
}
