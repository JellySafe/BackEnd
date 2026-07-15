import { ApiProperty } from '@nestjs/swagger';

/**
 * AUTH-001 POST /admin/auth/login 응답.
 * LoginUserResult 미러링 — 비밀번호 해시는 절대 노출하지 않는다.
 */
export class LoginUserResponse {
  @ApiProperty({ example: 1, description: '사용자 id' }) userId!: number;
  @ApiProperty({ example: 'admin@jellysafe.local' }) email!: string;
  @ApiProperty({ example: 'admin', enum: ['public', 'operator', 'admin'] }) role!: string;
  @ApiProperty({ example: '시스템 관리자' }) name!: string;
  @ApiProperty({ example: '2026-07-13T03:55:37.483Z', nullable: true, type: String })
  lastLoginAt!: string | null;
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: '관리자 API 호출용 JWT' })
  accessToken!: string;
}
