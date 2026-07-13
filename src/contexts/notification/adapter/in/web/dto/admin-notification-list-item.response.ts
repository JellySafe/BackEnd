import { ApiProperty } from '@nestjs/swagger';

/** ADM-010 GET /admin/notifications 관리자 알림함 한 행 (AdminNotificationListItem 미러링). */
export class AdminNotificationListItemResponse {
  @ApiProperty({ example: 5012, description: '알림 식별자' })
  notificationId!: number;

  @ApiProperty({
    example: 'operator',
    description: '알림 대상',
    enum: ['admin', 'operator', 'public'],
  })
  targetType!: string;

  @ApiProperty({ example: 12, description: '해변 식별자' })
  beachId!: number;

  @ApiProperty({ example: '협재해수욕장', description: '해변명', nullable: true })
  beachName!: string | null;

  @ApiProperty({
    example: 'danger',
    description: '위험 단계',
    enum: ['safe', 'caution', 'danger', 'severe'],
    nullable: true,
  })
  riskLevel!: string | null;

  @ApiProperty({
    example: 'level_up',
    description: '알림 발생 이벤트',
    enum: ['level_up', 'toxic_report', 'sting_report'],
  })
  eventType!: string;

  @ApiProperty({
    example: '[위험] 협재해수욕장 해파리 주의',
    description: '알림 제목(제목 없이 생성된 알림은 null)',
    nullable: true,
  })
  title!: string | null;

  @ApiProperty({
    example: '협재해수욕장 위험도가 위험 단계입니다.',
    description: '알림 문구',
  })
  message!: string;

  @ApiProperty({ example: '2026-07-10T09:12:00.000Z', description: '알림 생성 일시' })
  createdAt!: string;

  @ApiProperty({
    example: '2026-07-10T09:30:00.000Z',
    description: '열람 일시(미열람이면 null)',
    nullable: true,
  })
  readAt!: string | null;
}
