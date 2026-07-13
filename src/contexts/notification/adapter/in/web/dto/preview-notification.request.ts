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
  @IsInt()
  @Min(1)
  beachId!: number;

  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType!: NotificationTarget;

  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;

  /** 화면에 입력이 없으므로 optional. 미지정 시 서비스가 level_up 을 기본값으로 쓴다. */
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS as readonly string[])
  eventType?: NotificationEvent;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateCode?: string;
}
