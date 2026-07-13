import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_TARGETS,
  NotificationEvent,
  NotificationTarget,
} from '../../../../domain/notification-enums';

/**
 * ADM-010 POST /admin/notifications 요청 (관리자 수동 발송).
 * 화면 입력: 받는 사람(targetType), 위치(beachId), 제목(title), 상세 설명(message).
 * eventType 은 화면에 없으므로 optional (미지정 시 level_up).
 */
export class SendNotificationRequest {
  /** 받는 사람: admin(관리자) | operator(운영자) | public(관광객) */
  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType!: NotificationTarget;

  /** 위치(해변) */
  @IsInt()
  @Min(1)
  beachId!: number;

  /** 미지정 시 level_up (DB event_type CHECK 계약값). */
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS as readonly string[])
  eventType?: NotificationEvent;

  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;

  /** 제목. 지정 시 notifications.title 에 저장한다(미지정이면 템플릿 title, 없으면 null). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** 상세 설명. 지정 시 템플릿 치환 대신 이 문구를 그대로 저장한다. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
