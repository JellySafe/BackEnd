import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { MetricsSnapshot } from './metrics';

/** 산출 배치 건수를 세는 창(시간). 하루면 "어젯밤부터 멎었다" 를 판단하기에 충분하다. */
const CALCULATION_WINDOW_HOURS = 24;

/**
 * 운영 지표 수집 질의.
 *
 * ── 왜 shared 에 있고, 왜 Kysely 인가 ────────────────────────────────────────────────
 * 지표는 **여러 컨텍스트를 가로지르는 운영용 읽기 모델**이다(위험도 + 수집 + 제보). 특정
 * 컨텍스트의 소유물이 아니라 어느 한 곳에 두면 그 컨텍스트가 남의 테이블을 알게 된다.
 * `shared` 는 `contexts` 를 참조하지 않는다는 규칙을 지키기 위해, 도메인 코드를 끌어오지 않고
 * 생성된 DB 타입만으로 질의한다(대시보드 집계와 같은 방식이다).
 *
 * ── 나이를 DB 에서 계산하는 이유 ─────────────────────────────────────────────────────
 * `TIMESTAMPDIFF` 로 **DB 시계 기준** 경과 시간을 구한다. 앱에서 `Date.now()` 로 빼면
 * 앱 서버와 DB 의 시계가 어긋난 만큼 지표가 통째로 밀린다(관리형 DB 는 다른 호스트다).
 * 저장도 비교도 DB 가 하므로 DB 시계 하나만 기준으로 삼는 편이 흔들리지 않는다.
 */
@Injectable()
export class MetricsKyselyQuery {
  constructor(private readonly db: KyselyService) {}

  async collect(): Promise<MetricsSnapshot> {
    // 서로 무관한 질의라 병렬로 던진다. 지표 수집이 느려 스크레이프가 타임아웃되면
    // "지표가 없는 것"과 "서비스가 죽은 것"을 구분할 수 없게 된다.
    const [
      riskCalculationAgeSeconds,
      riskCalculationCounts,
      oldestLatestRiskScoreAgeSeconds,
      currentRiskLevels,
      syncHealthCounts,
      pendingVision,
      unreviewedReportCount,
    ] = await Promise.all([
      this.lastSuccessfulCalculationAge(),
      this.calculationCountsByStatus(),
      this.oldestLatestRiskScoreAge(),
      this.currentRiskLevelDistribution(),
      this.syncStatusCounts(),
      this.pendingVision(),
      this.unreviewedReports(),
    ]);

    return {
      uptimeSeconds: Math.floor(process.uptime()),
      riskCalculationAgeSeconds,
      riskCalculationCounts,
      oldestLatestRiskScoreAgeSeconds,
      currentRiskLevels,
      syncHealthCounts,
      pendingVisionCount: pendingVision.count,
      oldestPendingVisionAgeSeconds: pendingVision.oldestAgeSeconds,
      unreviewedReportCount,
    };
  }

  /**
   * 마지막으로 **끝까지 성공한** 산출이 끝난 뒤 지난 초.
   *
   * `partial` 도 성공으로 센다 — 해변 몇 곳이 실패해도 나머지는 갱신됐으므로 "배치가 멎은
   * 상태" 는 아니다. 부분 실패 자체는 아래 상태별 건수 지표가 따로 드러낸다.
   */
  private async lastSuccessfulCalculationAge(): Promise<number | null> {
    const row = await this.db
      .selectFrom('risk_calculations')
      .select(sql<number | null>`TIMESTAMPDIFF(SECOND, MAX(finished_at), NOW())`.as('age'))
      .where('calc_status', 'in', ['success', 'partial'])
      .where('finished_at', 'is not', null)
      .executeTakeFirst();

    return row?.age ?? null;
  }

  private async calculationCountsByStatus(): Promise<{ status: string; count: number }[]> {
    const rows = await this.db
      .selectFrom('risk_calculations')
      .select(['calc_status as status'])
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where(sql<boolean>`started_at >= NOW() - INTERVAL ${sql.lit(CALCULATION_WINDOW_HOURS)} HOUR`)
      .groupBy('calc_status')
      .execute();

    return rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  /** 노출 중인 위험도 중 가장 오래된 것의 나이. 한 곳이라도 밀리면 드러나야 한다. */
  private async oldestLatestRiskScoreAge(): Promise<number | null> {
    const row = await this.db
      .selectFrom('risk_scores')
      .select(sql<number | null>`TIMESTAMPDIFF(SECOND, MIN(generated_at), NOW())`.as('age'))
      // MySQL BOOLEAN 은 tinyint 라 생성 타입이 number 다. 최신본에만 1 이 들어간다
      // ("1 또는 NULL" 트릭 — risk.prisma-repository.ts 참고).
      .where('is_latest', '=', 1)
      .executeTakeFirst();

    return row?.age ?? null;
  }

  private async currentRiskLevelDistribution(): Promise<{ level: string; count: number }[]> {
    const rows = await this.db
      .selectFrom('risk_scores')
      .select(['risk_level as level'])
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('is_latest', '=', 1)
      .where('horizon', '=', 'now')
      .groupBy('risk_level')
      .execute();

    return rows.map((r) => ({ level: r.level, count: Number(r.count) }));
  }

  /**
   * 수집 소스 상태별 개수.
   *
   * sync-health 의 정식 판정(zero_yield 등)은 observation 컨텍스트가 소유한다. 여기서 그
   * 로직을 다시 구현하면 두 곳이 어긋나므로, 지표는 **DB 에 기록된 마지막 상태**만 센다.
   * 정밀한 진단은 관리자 화면(수집 상태)이 하고, 지표는 "뭔가 실패하고 있다" 만 알린다.
   */
  private async syncStatusCounts(): Promise<{ health: string; count: number }[]> {
    const rows = await this.db
      .selectFrom('data_sources')
      .select(['last_sync_status as status'])
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('is_active', '=', 1)
      .groupBy('last_sync_status')
      .execute();

    return rows.map((r) => ({
      // 한 번도 안 돈 소스는 NULL 이다. 'never' 로 이름을 붙여야 라벨에서 사라지지 않는다.
      health: r.status ?? 'never',
      count: Number(r.count),
    }));
  }

  private async pendingVision(): Promise<{ count: number; oldestAgeSeconds: number | null }> {
    const row = await this.db
      .selectFrom('vision_results')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .select(sql<number | null>`TIMESTAMPDIFF(SECOND, MIN(requested_at), NOW())`.as('age'))
      .where('process_status', 'in', ['pending', 'processing'])
      .executeTakeFirst();

    return { count: Number(row?.count ?? 0), oldestAgeSeconds: row?.age ?? null };
  }

  /** 아직 검수 결과가 붙지 않은 제보. AI 처리 단계까지가 대기 상태다. */
  private async unreviewedReports(): Promise<number> {
    const row = await this.db
      .selectFrom('jellyfish_reports')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('status', 'in', ['received', 'ai_processing', 'ai_done'])
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
