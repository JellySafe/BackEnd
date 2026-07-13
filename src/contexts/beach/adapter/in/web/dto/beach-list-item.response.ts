import { ApiProperty } from '@nestjs/swagger';

/** USR-001 공개 해변 목록 한 행 응답 (BeachListItem 미러). */
export class BeachListItemResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;
  @ApiProperty({ example: '제주시' }) region!: string;
  @ApiProperty({ example: 33.3941 }) lat!: number;
  @ApiProperty({ example: 126.2396 }) lng!: number;
  @ApiProperty({ example: 'danger', nullable: true }) currentRiskLevel!: string | null;
  @ApiProperty({ example: 1 }) priority!: number;
}
