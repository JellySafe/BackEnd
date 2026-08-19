import { ApiProperty } from '@nestjs/swagger';

/**
 * AUTH-001 POST /admin/auth/refresh 응답.
 * 요청에 쓴 refreshToken 은 이 응답 시점에 이미 무효다 — 여기 담긴 새 값으로 교체해야 한다.
 */
export class RefreshSessionResponse {
  @ApiProperty({ example: 1, description: '사용자 id' }) userId!: number;
  @ApiProperty({ example: 'admin@jellysafe.local' }) email!: string;
  @ApiProperty({ example: 'admin', enum: ['public', 'operator', 'admin'] }) role!: string;
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: '새 accessToken. 이후 /admin/* 요청에 이 값을 쓴다.',
  })
  accessToken!: string;
  @ApiProperty({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    description: '새 refreshToken. **저장해 둔 이전 값을 이 값으로 덮어써야 한다.**',
  })
  refreshToken!: string;
  @ApiProperty({ example: '2026-09-02T00:00:00.000Z', description: 'refreshToken 만료 시각' })
  refreshTokenExpiresAt!: string;
}

/**
 * AUTH-001 POST /admin/auth/logout 응답.
 */
export class LogoutResponse {
  @ApiProperty({
    example: 2,
    description:
      '실제로 무효화된 토큰 수. 없는 토큰·이미 무효한 토큰이면 0 이며, 그 경우에도 성공(200)이다.',
  })
  revokedCount!: number;
}
