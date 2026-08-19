import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/logout 요청.
 */
export class LogoutRequest {
  @ApiProperty({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    minLength: 44,
    maxLength: 44,
    description: '무효화할 refreshToken. 없는 값·이미 무효한 값이어도 성공으로 응답한다.',
  })
  @IsString()
  @Length(44, 44)
  refreshToken!: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'true 면 그 계정의 **모든 기기**에서 재발급을 끊는다. 기기 분실·비밀번호 유출 대응용.',
  })
  @IsOptional()
  @IsBoolean()
  allDevices?: boolean;
}
