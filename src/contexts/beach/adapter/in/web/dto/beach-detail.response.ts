import { ApiProperty } from '@nestjs/swagger';

/** 해변 마스터 상세 응답 (BeachDetail 미러 - 등록/수정/단건 조회 공통). */
export class BeachDetailResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;
  @ApiProperty({ example: '제주시' }) region!: string;
  @ApiProperty({ example: 33.3941 }) lat!: number;
  @ApiProperty({ example: 126.2396 }) lng!: number;
  @ApiProperty({ example: 180, nullable: true }) facingDirection!: number | null;
  @ApiProperty({ example: 1 }) priority!: number;
  @ApiProperty({ example: 50 }) vulnerabilityScore!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', nullable: true }) createdAt!: Date | null;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', nullable: true }) updatedAt!: Date | null;
}
