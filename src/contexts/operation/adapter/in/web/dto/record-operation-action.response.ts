import { ApiProperty } from '@nestjs/swagger';

/** ADM-007 대응 기록 저장 결과 응답 (RecordOperationActionResult 미러). */
export class RecordOperationActionResponse {
  @ApiProperty({ example: 1 }) actionId!: number;
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: 'entry_caution' }) operationStatus!: string;
  @ApiProperty({ example: 'normal', nullable: true }) previousStatus!: string | null;
  @ApiProperty({ example: 10 }) createdBy!: number;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z' }) createdAt!: Date;
}
