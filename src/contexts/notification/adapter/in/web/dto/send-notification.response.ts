import { ApiProperty } from '@nestjs/swagger';

/** ADM-010 POST /admin/notifications 응답 (SendNotificationResult 미러링). */
export class SendNotificationResponse {
  @ApiProperty({ example: true, description: '알림이 하나라도 생성되었는지 여부' })
  created!: boolean;

  @ApiProperty({
    example: 5012,
    description: '단일 브로드캐스트(admin/operator) 발송 시 생성된 알림 식별자. public 확산 시 null',
    nullable: true,
  })
  notificationId!: number | null;

  @ApiProperty({
    example: 24,
    description: 'public(관광객) 확산 시 실제 알림이 생성된 수신자 수',
    required: false,
  })
  recipientCount?: number;
}
