import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/login 요청.
 */
export class LoginUserRequest {
  @ApiProperty({
    example: 'test@jellysafe.local',
    format: 'email',
    maxLength: 255,
    description: '로그인 이메일. 개발용 시드 계정은 test@jellysafe.local 이다.',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'test1234',
    format: 'password',
    maxLength: 100,
    description: '비밀번호. 개발용 시드 계정의 비밀번호는 test1234 다.',
  })
  @IsString()
  @MaxLength(100)
  password!: string;
}
