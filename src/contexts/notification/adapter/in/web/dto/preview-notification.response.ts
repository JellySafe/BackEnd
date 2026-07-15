import { ApiProperty } from '@nestjs/swagger';

/** ADM-010 POST /admin/notifications/preview 응답 (PreviewNotificationResult 미러링). */
export class PreviewNotificationResponse {
  @ApiProperty({
    example: '[위험] 협재해수욕장 해파리 주의보',
    description: '치환 완료된 알림 제목(템플릿에 title 이 없으면 null)',
    nullable: true,
  })
  title!: string | null;

  @ApiProperty({
    example: '협재해수욕장 위험도가 위험 단계입니다. 입수를 자제해 주세요.',
    description: '치환 완료된 알림/안내방송 문구',
  })
  message!: string;

  @ApiProperty({
    example: 'operator',
    description: '알림 대상',
    enum: ['admin', 'operator', 'public'],
  })
  targetType!: string;

  @ApiProperty({
    example: 'LEVEL_UP_OPERATOR',
    description: '사용된 템플릿 코드(매칭 실패 시 null)',
    nullable: true,
  })
  templateCode!: string | null;
}
