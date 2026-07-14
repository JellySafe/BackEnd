import { ConfigService } from '@nestjs/config';

/**
 * notification 컨텍스트 전용 환경 변수 헬퍼.
 * 공용 AppConfig(@shared/config) 와 같은 방식(ConfigService 래핑)이며,
 * 알림 보관 정책만 여기서 읽는다.
 */
export class NotificationConfig {
  constructor(private readonly config: ConfigService) {}

  /** 알림 보관 일수. 이보다 오래된 알림은 파기한다. 0 이면 파기하지 않는다. */
  get notificationRetentionDays(): number {
    const raw = Number(this.config.get<string>('NOTIFICATION_RETENTION_DAYS') ?? '90');
    return Number.isFinite(raw) && raw >= 0 ? raw : 90;
  }

  /** 알림 파기 배치 크론. 'off' 면 비활성. 다른 파기 배치(03:20/03:40)와 겹치지 않게 03:50. */
  get notificationPurgeCron(): string {
    return this.config.get<string>('NOTIFICATION_PURGE_CRON') ?? '0 50 3 * * *';
  }
}
