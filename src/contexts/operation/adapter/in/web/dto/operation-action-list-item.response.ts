import { ApiProperty } from '@nestjs/swagger';

/** 대응 이력 목록 한 행 응답 (OperationActionListItem 미러). */
export class OperationActionListItemResponse {
  @ApiProperty({ example: 1 }) actionId!: number;
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: 'entry_caution' }) operationStatus!: string;
  @ApiProperty({ example: 'broadcast', nullable: true }) actionType!: string | null;
  @ApiProperty({ example: '오후 입수 통제 안내 방송 실시', nullable: true }) memo!: string | null;
  @ApiProperty({ example: 100, nullable: true }) riskScoreId!: number | null;
  @ApiProperty({ example: 5, nullable: true }) recommendationId!: number | null;
  @ApiProperty({ example: 10 }) createdBy!: number;
  @ApiProperty({ example: '홍길동', nullable: true }) createdByName!: string | null;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z' }) createdAt!: Date;
}
