import { ApiProperty } from '@nestjs/swagger';

/** 최신 운영 상태 뷰 응답 (OperationStatusView 미러). 이력이 없으면 data 는 null. */
export class OperationStatusResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: 'entry_caution' }) operationStatus!: string;
  @ApiProperty({ example: 'broadcast', nullable: true }) actionType!: string | null;
  @ApiProperty({ example: 10 }) createdBy!: number;
  @ApiProperty({ example: '홍길동', nullable: true }) createdByName!: string | null;
  @ApiProperty({ example: '2026-07-10T09:00:00.000Z' }) createdAt!: Date;
}
