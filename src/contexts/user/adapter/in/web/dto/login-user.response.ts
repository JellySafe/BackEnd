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
  @ApiProperty({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    nullable: true,
    type: String,
    description: [
      '액세스 토큰 재발급용 토큰(`POST /admin/auth/refresh`). 기기에 저장해 두고 쓴다.',
      '**null 이면** 서버에 리프레시 토큰 저장소가 아직 준비되지 않은 것이다 —',
      '이 경우 accessToken 만으로 동작하며, 만료되면 다시 로그인해야 한다.',
    ].join(' '),
  })
  refreshToken!: string | null;
  @ApiProperty({
    example: '2026-09-02T00:00:00.000Z',
    nullable: true,
    type: String,
    description: 'refreshToken 만료 시각. 이 시각이 지나면 재로그인이 필요하다.',
  })
  refreshTokenExpiresAt!: string | null;
}
