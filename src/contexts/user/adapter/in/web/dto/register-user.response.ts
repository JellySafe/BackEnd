import { ApiProperty } from '@nestjs/swagger';

/**
 * AUTH-001 POST /admin/auth/register 응답.
 * RegisterUserResult 미러링 — 비밀번호 해시는 노출하지 않는다.
 */
export class RegisterUserResponse {
  @ApiProperty({ example: 1, description: '생성된 사용자 id' }) userId!: number;
  @ApiProperty({ example: 'operator@jellysafe.local' }) email!: string;
  @ApiProperty({ example: 'operator', enum: ['public', 'operator', 'admin'] }) role!: string;
}
