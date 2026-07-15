import { ApiProperty } from '@nestjs/swagger';

/** 관심 해변 목록 한 행 응답 (FavoriteListItem 미러 - 현재 위험단계 포함). */
export class FavoriteListItemResponse {
  @ApiProperty({ example: 1 }) favoriteId!: number;
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) beachName!: string;
  @ApiProperty({ example: '제주시' }) region!: string;
  @ApiProperty({ example: 'danger', nullable: true }) currentRiskLevel!: string | null;
  @ApiProperty({ example: 68, nullable: true }) currentRiskScore!: number | null;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z' }) createdAt!: Date;
}
