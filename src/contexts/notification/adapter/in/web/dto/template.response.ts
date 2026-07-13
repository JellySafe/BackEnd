import { ApiProperty } from '@nestjs/swagger';

/** ADM-010 GET /admin/notification-templates 목록 한 행 (TemplateRecord 미러링). */
export class TemplateResponse {
  @ApiProperty({ example: 7, description: '템플릿 식별자' })
  id!: number;

  @ApiProperty({ example: 'LEVEL_UP_OPERATOR', description: '템플릿 코드' })
  templateCode!: string;

  @ApiProperty({
    example: 'operator',
    description: '알림 대상',
    enum: ['admin', 'operator', 'public'],
  })
  targetType!: string;

  @ApiProperty({
    example: 'danger',
    description: '적용 위험 단계(무관이면 null)',
    enum: ['safe', 'caution', 'danger', 'severe'],
    nullable: true,
  })
  riskLevel!: string | null;

  @ApiProperty({
    example: 'level_up',
    description: '적용 이벤트(무관이면 null)',
    enum: ['level_up', 'toxic_report', 'sting_report'],
    nullable: true,
  })
  eventType!: string | null;

  @ApiProperty({ example: '위험 단계 상승 안내', description: '제목', nullable: true })
  title!: string | null;

  @ApiProperty({
    example: '{beachName} 위험도가 {riskLevel} 단계입니다.',
    description: '본문(치환 전 템플릿)',
  })
  body!: string;
}
