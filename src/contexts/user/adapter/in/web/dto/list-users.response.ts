import { ApiProperty } from '@nestjs/swagger';

/**
 * GET /admin/users 목록 한 행 응답.
 * UserListItem 미러링 — 비밀번호 해시는 노출하지 않는다.
 */
export class UserListItemResponse {
  @ApiProperty({ example: 1 }) userId!: number;
  @ApiProperty({ example: 'operator@jellysafe.local' }) email!: string;
  @ApiProperty({ example: '홍길동' }) name!: string;
  @ApiProperty({ example: 'operator', enum: ['public', 'operator', 'admin'] }) role!: string;
  @ApiProperty({ example: '부산광역시 해양수산과', nullable: true, type: String })
  organization!: string | null;
  @ApiProperty({ example: '부산', nullable: true, type: String }) managedRegion!: string | null;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: '2026-07-13T03:55:37.483Z', nullable: true, type: String })
  lastLoginAt!: string | null;
  @ApiProperty({ example: '2026-07-01T00:00:00.000Z' }) createdAt!: string;
}
