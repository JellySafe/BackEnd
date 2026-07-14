import { ConfigService } from '@nestjs/config';

/**
 * 환경 변수 접근 헬퍼. 타입 안전하게 읽는다.
 */
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV') ?? 'development';
  }

  get port(): number {
    return Number(this.config.get('PORT') ?? 3000);
  }

  get apiPrefix(): string {
    return this.config.get<string>('API_PREFIX') ?? 'api';
  }

  get riskRuleVersion(): string {
    return this.config.get<string>('RISK_RULE_VERSION') ?? 'v1';
  }

  get visionAiMode(): 'mock' | 'remote' {
    return (this.config.get<string>('VISION_AI_MODE') as 'mock' | 'remote') ?? 'mock';
  }

  get schedulerEnabled(): boolean {
    return (this.config.get<string>('SCHEDULER_ENABLED') ?? 'true') === 'true';
  }

  get observationSyncCron(): string {
    return this.config.get<string>('OBSERVATION_SYNC_CRON') ?? '0 */30 * * * *';
  }

  /**
   * 위험도 재산출 전용 크론. 기본값은 'off'(비활성)다.
   *
   * 위험도 재산출은 관측 스케줄러(OBSERVATION_SYNC_CRON, 30분)가 수집·매핑 직후에
   * 이어서 실행한다. 신선한 관측치로 계산하는 게 맞으므로 그쪽이 제자리다.
   * 이 크론까지 켜두면 같은 계산이 시간당 한 번 더 돌아 risk_scores/risk_factors 만
   * 중복으로 쌓인다(실제로 시간당 3회씩 쌓이고 있었다).
   *
   * 관측 수집을 끄고 위험도만 따로 돌려야 하는 상황에서만 크론식을 지정한다.
   */
  get riskRecalcCron(): string {
    return this.config.get<string>('RISK_RECALC_CRON') ?? 'off';
  }

  /** 위험도 이력 보관 일수. 이보다 오래된 산출 이력은 파기한다. 0 이면 파기하지 않는다. */
  get riskHistoryRetentionDays(): number {
    const raw = Number(this.config.get<string>('RISK_HISTORY_RETENTION_DAYS') ?? '90');
    return Number.isFinite(raw) && raw >= 0 ? raw : 90;
  }

  get riskHistoryPurgeCron(): string {
    return this.config.get<string>('RISK_HISTORY_PURGE_CRON') ?? '0 40 3 * * *';
  }

  get dailyReportCron(): string {
    return this.config.get<string>('DAILY_REPORT_CRON') ?? '0 10 0 * * *';
  }
}

/** 크론 설정이 비활성('off'/빈 값)인지. */
export function isCronDisabled(cronTime: string): boolean {
  const normalized = cronTime.trim().toLowerCase();
  return normalized === '' || normalized === 'off' || normalized === 'false';
}

export const APP_CONFIG = Symbol('APP_CONFIG');
