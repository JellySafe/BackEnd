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
 * ADM-010 POST /admin/notifications 요청 (관리자 수동 발송).
 * 화면 입력: 받는 사람(targetType), 위치(beachId), 제목(title), 상세 설명(message).
 * eventType 은 화면에 없으므로 optional (미지정 시 level_up).
 */
export class SendNotificationRequest {
  /** 받는 사람: admin(관리자) | operator(운영자) | public(관광객) */
  @ApiProperty({
    enum: NOTIFICATION_TARGETS,
    example: 'public',
    description:
      '알림을 받을 사람. 발송 화면의 "받는 사람" 항목. admin(관리자) / operator(운영자) / public(해당 해변을 즐겨찾기한 관광객).',
  })
  @IsIn(NOTIFICATION_TARGETS as readonly string[])
  targetType!: NotificationTarget;

  /** 위치(해변) */
  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '알림이 가리키는 해변의 id (예: 1 = 협재해수욕장). 발송 화면의 "위치" 항목.',
  })
  @IsInt()
  @Min(1)
  beachId!: number;

  /** 미지정 시 level_up (DB event_type CHECK 계약값). */
  @ApiPropertyOptional({
    enum: NOTIFICATION_EVENTS,
    example: 'level_up',
    description:
      '알림이 발생한 상황. level_up(단계 상승) / toxic_report(독성 의심 제보) / sting_report(쏘임 사고). 발송 화면에는 입력칸이 없고, 생략하면 level_up 으로 기록된다.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS as readonly string[])
  eventType?: NotificationEvent;

  @ApiPropertyOptional({
    enum: RISK_LEVELS,
    example: 'danger',
    description: '알림에 함께 실을 위험 단계. 템플릿 문구의 {riskLevel} 자리에 들어간다.',
  })
  @IsOptional()
  @IsIn(RISK_LEVELS as readonly string[])
  riskLevel?: RiskLevel;

  /** 제목. 지정 시 notifications.title 에 저장한다(미지정이면 템플릿 title, 없으면 null). */
  @ApiPropertyOptional({
    example: '협재해수욕장 위험 단계 상승',
    maxLength: 200,
    description:
      '알림 제목. 발송 화면의 "제목" 입력값. 생략하면 템플릿의 제목을 쓰고, 그것도 없으면 제목 없이 나간다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** 상세 설명. 지정 시 템플릿 치환 대신 이 문구를 그대로 저장한다. */
  @ApiPropertyOptional({
    example: '협재해수욕장 위험도가 danger 단계로 상승했습니다. 입수를 자제해 주세요.',
    maxLength: 2000,
    description:
      '알림 본문. 발송 화면의 "상세 설명" 입력값. 넣으면 템플릿 대신 이 문구가 그대로 나간다. 생략하면 템플릿에 해변명·위험단계를 채워 만든다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
