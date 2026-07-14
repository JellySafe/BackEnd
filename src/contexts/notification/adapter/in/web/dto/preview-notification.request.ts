import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_TARGETS,
  NotificationEvent,
  NotificationTarget,
} from '../../../../domain/notification-enums';

/**
 * ADM-010 POST /admin/notifications/preview 요청.
 */
export class PreviewNotificationRequest {
  @ApiProperty({
    example: 1,
    minimum: 1,
    description:
      '미리보기 기준 해변의 id (예: 1 = 협재해수욕장). 템플릿의 {beachName} 자리에 이 해변 이름이 채워진다.',
  })
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiProperty({
    enum: NOTIFICATION_TARGETS,
    example: 'operator',
    description: '받는 사람. admin(관리자) / operator(운영자) / public(관광객). 대상에 따라 문구 톤이 달라진다.',
  })
  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType!: NotificationTarget;

  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    example: 'danger',
    description: '문구에 넣을 위험 단계. 템플릿의 {riskLevel} 자리에 채워진다.',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;

  /** 화면에 입력이 없으므로 optional. 미지정 시 서비스가 level_up 을 기본값으로 쓴다. */
  @ApiPropertyOptional({
    enum: NOTIFICATION_EVENTS,
    example: 'level_up',
    description:
      '어떤 상황의 문구인지. level_up(단계 상승) / toxic_report(독성 의심 제보) / sting_report(쏘임 사고). 생략하면 level_up 으로 미리보기한다.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS as readonly string[])
  eventType?: NotificationEvent;

  @ApiPropertyOptional({
    example: 'LEVEL_UP_OPERATOR',
    maxLength: 50,
    description:
      '특정 템플릿을 콕 집어 미리보기할 때 쓰는 코드(예: LEVEL_UP_OPERATOR, TOXIC_OPERATOR, STING_OPERATOR, LEVEL_UP_PUBLIC). 생략하면 targetType+eventType 에 맞는 템플릿을 서버가 고른다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateCode?: string;
}
