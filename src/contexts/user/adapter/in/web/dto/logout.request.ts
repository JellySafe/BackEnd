import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/logout 요청.
 *
 * `refreshToken` 은 선택이다 — 브라우저는 `js_refresh_token` 쿠키로 보낸다(이슈 #55).
 * 둘 다 없어도 200 이다(무효화 0건). 로그아웃은 "그 토큰이 더는 쓰이지 않는 상태"가 목적이고,
 * 보낼 토큰이 없다면 그 목적은 이미 달성돼 있다. 쿠키는 어느 경우든 지운다.
 */
export class LogoutRequest {
  @ApiPropertyOptional({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    minLength: 44,
    maxLength: 44,
    description: '무효화할 refreshToken. 없는 값·이미 무효한 값이어도 성공으로 응답한다.',
  })
  @IsOptional()
  @IsString()
  @Length(44, 44)
  refreshToken?: string;

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
