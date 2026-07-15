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

  // ---------------------------------------------------------------- 관측 보관 정책

  /** 관측치 보관 일수. 이보다 오래된 관측은 파기한다. 0 이면 파기하지 않는다. */
  get observationRetentionDays(): number {
    return this.nonNegative('OBSERVATION_RETENTION_DAYS', 30);
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
