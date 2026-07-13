import { ApiProperty } from '@nestjs/swagger';

/** ADM-005 관리자 해변 마스터 목록 한 행 응답 (BeachAdminItem 미러). */
export class BeachAdminItemResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;
  @ApiProperty({ example: '제주시' }) region!: string;
  @ApiProperty({ example: 33.3941 }) lat!: number;
  @ApiProperty({ example: 126.2396 }) lng!: number;
  @ApiProperty({ example: 180, nullable: true }) facingDirection!: number | null;
  @ApiProperty({ example: 1 }) priority!: number;
  @ApiProperty({ example: 50 }) vulnerabilityScore!: number;
  @ApiProperty({ example: true }) isActive!: boolean;
}
