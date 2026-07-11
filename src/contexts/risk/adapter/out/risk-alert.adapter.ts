import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
} from '@contexts/notification/application/port/in/notification-use-cases';
import { NotifyLevelUpInput, RiskAlertPort } from '../../application/port/out/risk-alert.port';

/**
 * 위험 단계 상승 알림 어댑터.
 * notification 의 CreateNotificationUseCase(운영자 대상, level_up)로 위임한다.
 * 알림 생성 실패는 삼켜서(warn 로그) 위험도 산출 흐름을 막지 않는다. (NOTI-003 dedup 은 notification 이 처리)
 */
@Injectable()
export class RiskAlertAdapter implements RiskAlertPort {
  private readonly logger = new Logger(RiskAlertAdapter.name);

  constructor(
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
  ) {}

  async notifyLevelUp(input: NotifyLevelUpInput): Promise<void> {
    try {
      await this.createNotification.create({
        targetType: 'operator',
        beachId: input.beachId,
        riskLevel: input.riskLevel,
        eventType: 'level_up',
      });
    } catch (err) {
      this.logger.warn(
        `위험 단계 상승 알림 생성 실패 (beach ${input.beachId}, ${input.previousLevel ?? '?'}→${input.riskLevel}): ${err}`,
      );
    }
  }
}
