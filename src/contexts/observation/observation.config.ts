import { ConfigService } from '@nestjs/config';
import { SyncHealthThresholds, DEFAULT_SYNC_HEALTH_THRESHOLDS } from './domain/sync-health';

/**
 * observation 컨텍스트 전용 환경 변수 헬퍼.
 *
 * 공용 AppConfig(@shared/config) 와 같은 방식(ConfigService 래핑)이지만, 이 컨텍스트에서만
 * 쓰는 설정(수집 건강 판정 임계값 / 관측 보관 정책)을 여기 모아 둔다.
 * 잘못된 값(음수·NaN)은 기본값으로 되돌려 배치가 이상한 임계값으로 도는 것을 막는다.
 */
export class ObservationConfig {
  constructor(private readonly config: ConfigService) {}

  // ---------------------------------------------------------------- 수집 건강 판정

  get syncHealthThresholds(): SyncHealthThresholds {
    return {
      staleMultiplier: this.positive(
        'OBSERVATION_SOURCE_STALE_MULTIPLIER',
        DEFAULT_SYNC_HEALTH_THRESHOLDS.staleMultiplier,
      ),
      defaultIntervalMinutes: this.positive(
        'OBSERVATION_SOURCE_DEFAULT_INTERVAL_MINUTES',
        DEFAULT_SYNC_HEALTH_THRESHOLDS.defaultIntervalMinutes,
      ),
      // 0 이면 판정 비활성(비수기 등 0건이 정상인 기간에 끌 수 있게).
      jellyfishZeroYieldDays: this.nonNegative(
        'OBSERVATION_JELLYFISH_ZERO_YIELD_DAYS',
        DEFAULT_SYNC_HEALTH_THRESHOLDS.jellyfishZeroYieldDays,
      ),
      marineZeroYieldHours: this.nonNegative(
        'OBSERVATION_MARINE_ZERO_YIELD_HOURS',
        DEFAULT_SYNC_HEALTH_THRESHOLDS.marineZeroYieldHours,
      ),
    };
  }

  // ---------------------------------------------------------------- 수집기 폴백

  /**
   * 실 수집기가 실패하거나 인증키가 없을 때 **mock 데이터로 대체할지** 여부.
   *
   * ── 기본값을 환경으로 가르는 이유 ──────────────────────────────────────────────
   * 운영(production)에서는 **끈다**. mock 은 관측소·시각 해시로 수온 15~29℃, 파고 0.1~3.2m,
   * 심지어 독성·고밀도 해파리 출현까지 그럴듯하게 만들어 내는데, 이 값들은 실데이터와
   * 구분 표시 없이 같은 테이블에 저장되고 30분 뒤 위험도 산출이 그대로 읽는다.
   * 즉 **외부 API 장애가 "가짜 안전/가짜 위험"으로 시민에게 표시된다.**
   *
   * 더 나쁜 건 고장 감지까지 가린다는 점이다. sync-health 는 "수집기가 0건을 반환하는 상태가
   * 이어지는가"(fetched=0)로 조용한 고장을 잡는데, mock 이 늘 행을 채워 주면 zeroRuns 가
   * 영원히 0 이라 **API 가 몇 주 죽어 있어도 대시보드는 정상**으로 보인다.
   *
   * 폴백을 끄면 실패는 실패로 기록되고(last_sync_status=failed), 결측은 도메인이 이미
   * 제대로 다룬다 — 결측 요인은 0점 처리되고 신뢰도가 low 로 내려간다(RISK-005).
   * **"모른다"를 표현할 수 있는 설계를 이미 갖췄으니 거짓말로 채우지 않는다.**
   *
   * 개발/CI(로컬)에서는 켠다. 인증키 없이도 화면이 도는 편이 낫고, 그 환경의 데이터는
   * 누구에게도 보여지지 않는다. MOCK_COLLECTOR_FALLBACK 으로 명시 지정할 수 있다.
   */
  get mockCollectorFallbackEnabled(): boolean {
    const raw = (this.config.get<string>('MOCK_COLLECTOR_FALLBACK') ?? '').trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // 미지정: 운영은 끄고, 그 외(development/test)는 켠다.
    return (this.config.get<string>('NODE_ENV') ?? 'development') !== 'production';
  }

  // ---------------------------------------------------------------- 관측 보관 정책

  /** 관측치 보관 일수. 이보다 오래된 관측은 파기한다. 0 이면 파기하지 않는다. */
  get observationRetentionDays(): number {
    return this.nonNegative('OBSERVATION_RETENTION_DAYS', 30);
  }

  /**
   * 해파리 출현 기록 보관 연수. 이보다 오래된 출현은 파기한다. 0 이면 파기하지 않는다.
   *
   * PAST_OCCURRENCE 가 과거 5년의 같은 시기를 세므로(CollectOptions.pastSeasonYears)
   * **그보다 짧게 잡으면 그 룰이 조용히 항상 0 이 된다.** 기본 6년으로 한 해 여유를 둔다.
   * 출현 기록은 주간보고 기준 연 수백 행 규모라 이 정도 보관은 부담이 되지 않는다.
   */
  get occurrenceRetentionYears(): number {
    return this.nonNegative('OCCURRENCE_RETENTION_YEARS', 6);
  }

  /** 관측 파기 배치 크론. 'off' 면 비활성. 위험도 이력 파기(03:40)와 겹치지 않게 03:20. */
  get observationPurgeCron(): string {
    return this.config.get<string>('OBSERVATION_PURGE_CRON') ?? '0 20 3 * * *';
  }

  // ---------------------------------------------------------------- 내부

  private positive(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key) ?? fallback);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private nonNegative(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key) ?? fallback);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  }
}
