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

  get riskRecalcCron(): string {
    return this.config.get<string>('RISK_RECALC_CRON') ?? '0 5 * * * *';
  }

  get dailyReportCron(): string {
    return this.config.get<string>('DAILY_REPORT_CRON') ?? '0 10 0 * * *';
  }
}

export const APP_CONFIG = Symbol('APP_CONFIG');
