import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_JWT_EXPIRES } from './duration';

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
   * 액세스 토큰 수명(기간 문자열). 기본 30분.
   *
   * ⚠️ **이 값이 곧 토큰 유출 시 최대 노출 시간이다.** 액세스 토큰은 서명만으로 검증되므로
   * 로그아웃도, 계정 정지도, 유출 인지도 남은 수명을 앞당기지 못한다(logout.service.ts).
   *
   * 예전 기본값은 12시간이었다. 그 토큰 하나로 해변 마스터 수정·사용자 목록·감사 로그에
   * 닿을 수 있는데, 반나절이면 유출을 알아차리고 대응하기에도 이미 늦은 시간이다.
   * 재발급(리프레시) 흐름이 붙은 뒤로는 짧게 두는 데 드는 운영 비용이 없다 — 만료되면
   * 클라이언트가 `POST /admin/auth/refresh` 로 조용히 갱신한다.
   *
   * 형식·상한(운영 2시간)은 env 검증이 기동 시점에 고정한다(duration.ts).
   */
  get jwtExpires(): string {
    const raw = (this.config.get<string>('JWT_EXPIRES') ?? '').trim();
    return raw === '' ? DEFAULT_JWT_EXPIRES : raw;
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

  /**
   * 배치 중복 실행을 막는 락의 구현. `mysql`(기본) | `memory`.
   *
   * `memory` 는 프로세스 안에서만 유효해 **머신이 하나일 때만** 맞다. `mysql` 은 MySQL 의
   * 사용자 락(GET_LOCK)을 써서 인스턴스가 여럿이어도 하나만 실행되게 한다 — 머신이
   * 하나일 때도 동작이 같으므로 기본값으로 둔다(scheduling.module.ts 참고).
   */
  get jobLockDriver(): 'mysql' | 'memory' {
    return this.config.get<string>('JOB_LOCK_DRIVER') === 'memory' ? 'memory' : 'mysql';
  }

  /**
   * 2차 기능(EX-001~004: 제휴 API·구독·모델 관리) 활성 여부. 기본 true(현재 동작 유지).
   *
   * false 로 두면 해당 경로가 전부 404 가 된다. 제휴사가 한 곳도 없는 환경에서
   * `/partner/v1/*`(별도 자격증명으로 들어오는 문)을 열어 둘 이유가 없기 때문이다.
   * 판정은 SecondaryEnabledGuard 가 한다.
   */
  get secondaryEnabled(): boolean {
    return (this.config.get<string>('SECONDARY_ENABLED') ?? 'true') !== 'false';
  }

  /**
   * 예측 대조 배치 크론. 기본 새벽 4시(KST 가 아니라 서버 시각 기준이며 컨테이너는 UTC 다 —
   * fly.toml 의 TZ 설정을 따른다).
   *
   * 자정 직후가 아닌 이유: 대상이 **어제 하루**인데, 늦게 입력되는 현장 기록(퇴근 후 정리,
   * 119 연계)이 아직 안 들어와 오경보로 잘못 세어진다.
   */
  get predictionEvaluationCron(): string {
    return this.config.get<string>('PREDICTION_EVALUATION_CRON') ?? '0 0 4 * * *';
  }

  get dailyReportCron(): string {
    return this.config.get<string>('DAILY_REPORT_CRON') ?? '0 10 0 * * *';
  }

  /**
   * 리프레시 토큰 유효 일수(기본 14일).
   *
   * 이 값이 곧 **재로그인 없이 버틸 수 있는 기간**이자, 토큰이 새어 나갔을 때의 최대 노출
   * 기간이다. 관리자 콘솔은 매일 쓰는 도구가 아니라서 너무 짧으면 올 때마다 로그인해야 하고,
   * 너무 길면 회전이 없는 기기(오래 안 쓴 노트북)의 토큰이 오래 살아 있는다. 2주는 그 사이다.
   * 1 미만이면 기본값으로 되돌리고, 90일을 넘기지 않는다.
   */
  get refreshTokenExpiresDays(): number {
    const raw = Number(this.config.get<string>('REFRESH_TOKEN_EXPIRES_DAYS') ?? '14');
    if (!Number.isFinite(raw) || raw < 1) return 14;
    return Math.min(Math.floor(raw), 90);
  }

  /** 만료된 리프레시 토큰 파기 크론. 다른 파기 배치와 겹치지 않게 03:15 로 둔다. */
  get refreshTokenPurgeCron(): string {
    return this.config.get<string>('REFRESH_TOKEN_PURGE_CRON') ?? '0 15 3 * * *';
  }

  /**
   * 제보 사진·위치 보관 일수 (PRIV-003). 기본 90일.
   *
   * 접수 시점 + 이 기간이 `purge_scheduled_at` 이 되고, 그 시각이 지나면 파기 배치가 사진 파일을
   * 지우고 좌표를 마스킹한다. **접수 때 계산해 행에 박아 넣는 값이라, 값을 바꿔도 이미 접수된
   * 제보의 파기 시점은 바뀌지 않는다**(사용자가 동의한 그 시점의 정책이 그대로 적용된다).
   *
   * 하한 1일: 0 을 넣으면 접수 즉시 파기 대상이 되어 사진이 검수 전에 사라진다.
   */
  get reportRetentionDays(): number {
    const raw = Number(this.config.get<string>('REPORT_RETENTION_DAYS') ?? '90');
    if (!Number.isFinite(raw) || raw < 1) return 90;
    return Math.floor(raw);
  }

  /**
   * 동의 기록 보관 일수 (PRIV-001~003). 기본 365일.
   *
   * 제보 데이터(90일)보다 **길게 두는 것이 의도다.** 제보 사진·위치는 목적을 다하면 지워야 하지만,
   * 동의 기록은 그 수집이 적법했음을 사후에 증명하는 자료라 조금 더 남아 있어야 한다.
   * 다만 동의 기록도 개인정보(토큰·IP)이므로 무기한 보관하지 않는다.
   */
  get consentRetentionDays(): number {
    const raw = Number(this.config.get<string>('CONSENT_RETENTION_DAYS') ?? '365');
    if (!Number.isFinite(raw) || raw < 1) return 365;
    return Math.floor(raw);
  }
}

/** 크론 설정이 비활성('off'/빈 값)인지. */
export function isCronDisabled(cronTime: string): boolean {
  const normalized = cronTime.trim().toLowerCase();
  return normalized === '' || normalized === 'off' || normalized === 'false';
}

export const APP_CONFIG = Symbol('APP_CONFIG');
