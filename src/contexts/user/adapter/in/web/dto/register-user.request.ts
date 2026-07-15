import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { REGISTRABLE_ROLES, RegistrableRole } from '../../../../domain/user-enums';

/**
 * AUTH-001 POST /admin/auth/register 요청.
 * role 은 operator|admin 만 허용한다(public 은 익명 사용자).
 */
export class RegisterUserRequest {
  @ApiProperty({
    example: 'operator@jellysafe.local',
    format: 'email',
    maxLength: 255,
    description: '새 계정의 로그인 이메일. 이미 쓰이고 있는 이메일이면 거부된다.',
  })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'operator1234',
    format: 'password',
    minLength: 8,
    maxLength: 100,
    description: '비밀번호. 최소 8자.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @ApiProperty({
    example: '김운영',
    maxLength: 100,
    description: '담당자 이름. 관리자 화면의 사용자 목록에 표시된다.',
  })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    enum: REGISTRABLE_ROLES,
    example: 'operator',
    description:
      '권한 등급. operator(운영자 — 현장/지역 담당) 또는 admin(관리자 — 전체 권한). 일반 관광객(public)은 계정 없이 쓰므로 여기서 만들 수 없다.',
  })
  @IsIn(REGISTRABLE_ROLES as readonly string[])
  role!: RegistrableRole;

  @ApiPropertyOptional({
    example: '제주도 해양수산국',
    maxLength: 150,
    description: '소속 기관명.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  organization?: string;

  @ApiPropertyOptional({
    example: '제주시',
    enum: ['제주시', '서귀포시'],
    maxLength: 50,
    description: '운영자가 담당하는 지역.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  managedRegion?: string;
}
