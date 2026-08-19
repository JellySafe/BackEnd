import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';

/**
 * 환경 변수 접근 헬퍼. 타입 안전하게 읽는다.
 */
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV') ?? 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
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

  /**
   * 제보 이미지 업로드 디렉터리(절대 경로).
   *
   * 업로드 컨트롤러(저장)와 main.ts 의 정적 서빙(`/uploads/*`)이 **같은 값**을 봐야 한다.
   * 어느 한쪽만 바뀌면 파일은 올라가지만 열리지 않는다(과거에 실제로 그랬다).
   *
   * 컨테이너 파일시스템은 재배포마다 초기화되므로 운영에서는 영구 볼륨 마운트 경로를 넣는다.
   * (Fly: `/data` 에 볼륨 마운트 → UPLOAD_DIR=/data/uploads)
   * 상대 경로면 프로세스 CWD 기준으로 해석한다(기본값 `./uploads`).
   */
  get uploadDir(): string {
    const raw = (this.config.get<string>('UPLOAD_DIR') ?? '').trim();
    return resolve(process.cwd(), raw === '' ? './uploads' : raw);
  }

  /** 업로드된 이미지가 서빙되는 URL 프리픽스. imageUrl 값(`/uploads/파일명`)의 앞부분. */
  get uploadUrlPrefix(): string {
    return '/uploads/';
  }

  /**
   * `/system/*` 내부 API 호출용 공유 키(헤더 `x-system-key`).
   *
   * 미설정이면 `/system/*` 은 **전면 차단**된다(SystemAuthGuard 참고).
   * 스케줄러는 HTTP 를 타지 않고 유스케이스를 직접 호출하므로 배치는 이 키와 무관하다.
   */
  get systemApiKey(): string | null {
    const raw = (this.config.get<string>('SYSTEM_API_KEY') ?? '').trim();
    return raw === '' ? null : raw;
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

  /**
   * 부팅 시 '고아 산출'로 간주할 경과 시간(분). 0 이면 정리하지 않는다.
   * 기본 30분 = 관측 수집 배치 주기. 그보다 오래 running 인 행은 정상 진행 중일 수 없다.
   */
  get riskCalculationStaleMinutes(): number {
    const raw = Number(this.config.get<string>('RISK_CALCULATION_STALE_MINUTES') ?? '30');
    return Number.isFinite(raw) && raw >= 0 ? raw : 30;
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
