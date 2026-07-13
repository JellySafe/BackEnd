import { ApiProperty } from '@nestjs/swagger';

/** USR-003 PATCH /public/alerts/:id/read 응답 (MarkAlertReadResult 미러링). */
export class MarkAlertReadResponse {
  @ApiProperty({ example: 5012, description: '알림 식별자' })
  notificationId!: number;

  @ApiProperty({ example: '2026-07-10T09:30:00.000Z', description: '열람 처리 일시' })
  readAt!: string;
}
