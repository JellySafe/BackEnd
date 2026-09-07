import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { toId } from '@shared/kernel/id';
import { RiskLevel, isRiskLevel, maxRiskLevel } from '@shared/kernel/risk-level';
import { toKstDateString } from '@shared/kernel/kst-date';
import { PublicDailyReportQueryPort } from '../../../application/port/out/public-daily-report-query.port';
import { BeachDayFacts } from '../../../domain/public-daily-report';
import { dayWindow } from '../../../domain/daily-report';

/**
 * 공개 일간 리포트 집계 어댑터 (Kysely, 이슈 #56).
 *
 * ── 왜 SQL 한 방이 아니라 네 번 나눠 읽나 ────────────────────────────────────────────
 * 해변별 "그날 처음/마지막 단계" 는 SQL 로 하면 윈도 함수나 상관 서브쿼리가 필요하고, 그렇게
 * 쓴 질의는 읽기도 고치기도 어렵다. 그런데 대상이 작다 — **해변 12곳 × 30분 주기 = 하루 최대
 * 576행.** 원본을 그대로 읽어 와서 JS 에서 접는 편이 정확하고 검증하기 쉽다.
 *
 * 이 응답은 하루에 한 번 바뀌는 자료라 캐시가 붙는다(shared/cache). 질의 수가 요청 수를
 * 그대로 따라가지 않는다.
 *
 * ⚠️ 해변이 수백 곳으로 늘면 이 전제가 깨진다. 그때는 집계를 SQL 로 내리거나 `daily_reports`
 *    행을 읽는 쪽으로 바꿔야 한다(다만 그 경우 "오늘" 은 여전히 원본에서 봐야 한다).
 */
@Injectable()
export class PublicDailyReportKyselyQuery implements PublicDailyReportQueryPort {
  constructor(private readonly db: KyselyService) {}

  async beachDayFacts(reportDate: Date): Promise<BeachDayFacts[]> {
    const { start, end } = dayWindow(reportDate);

    const [beaches, riskRows, reportRows, commentRows] = await Promise.all([
      this.activeBeaches(),
      this.riskPoints(start, end),
      this.reportCounts(start, end),
      this.publicComments(reportDate),
    ]);

    const riskByBeach = foldRiskPoints(riskRows);
    const reportsByBeach = new Map(reportRows.map((r) => [Number(r.beachId), r]));
    const commentByBeach = new Map(commentRows.map((r) => [Number(r.beachId), r.comment]));

    return beaches.map((beach) => {
      const beachId = Number(beach.beachId);
      const risk = riskByBeach.get(beachId);
      const reports = reportsByBeach.get(beachId);

      return {
        beachId: toId(beach.beachId),
        name: beach.name,
        region: beach.region,
        firstRiskLevel: risk?.first ?? null,
        lastRiskLevel: risk?.last ?? null,
        maxRiskLevel: risk?.max ?? null,
        reportCount: Number(reports?.reportCount ?? 0),
        toxicCount: Number(reports?.toxicCount ?? 0),
        stingCount: Number(reports?.stingCount ?? 0),
        publicComment: commentByBeach.get(beachId) ?? null,
      };
    });
  }

  /**
   * 집계 대상 해변. **운영 중인 해변만** 본다 — 내린 해변이 시민 화면의 등급 집계에 남으면
   * 실제보다 많은 곳을 지켜보는 것처럼 보인다. 순서는 목록 화면과 같은 기준(priority)이다.
   */
  private activeBeaches(): Promise<{ beachId: number; name: string; region: string }[]> {
    return this.db
      .selectFrom('beaches')
      .select(['id as beachId', 'name', 'region'])
      .where('is_active', '=', 1)
      .orderBy('priority', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** 그날의 위험도 산출 이력(now 지평). 해변·시간순으로 정렬해 접기 좋게 준다. */
  private riskPoints(
    start: Date,
    end: Date,
  ): Promise<{ beachId: number; riskLevel: string; generatedAt: Date }[]> {
    return this.db
      .selectFrom('risk_scores')
      .select(['beach_id as beachId', 'risk_level as riskLevel', 'generated_at as generatedAt'])
      .where('horizon', '=', 'now')
      .where('generated_at', '>=', start)
      .where('generated_at', '<', end)
      .orderBy('beach_id', 'asc')
      .orderBy('generated_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  /** 그날의 제보 집계(해변별). */
  private reportCounts(
    start: Date,
    end: Date,
  ): Promise<{ beachId: number; reportCount: number; toxicCount: number; stingCount: number }[]> {
    return this.db
      .selectFrom('jellyfish_reports')
      .where('submitted_at', '>=', start)
      .where('submitted_at', '<', end)
      .where('beach_id', 'is not', null)
      .select((eb) => [
        'beach_id as beachId',
        eb.fn.countAll<number>().as('reportCount'),
        sql<number>`sum(case when ai_result = 'toxic_suspected' then 1 else 0 end)`.as('toxicCount'),
        sql<number>`sum(case when report_type = 'sting' then 1 else 0 end)`.as('stingCount'),
      ])
      .groupBy('beach_id')
      .execute() as Promise<
      { beachId: number; reportCount: number; toxicCount: number; stingCount: number }[]
    >;
  }

  /**
   * 운영자가 **공개를 선택해** 쓴 코멘트만 읽는다.
   *
   * ⚠️ 여기서 `memo` 를 같이 읽으면 안 된다. 그 컬럼은 내부용으로 쓰인 글이라, 공개 경로에
   *    붙는 순간 과거에 쓰인 것까지 소급해서 전부 공개된다(이슈 #56 본문의 지적과 같다).
   *    이 질의가 `public_comment` 하나만 고르는 것이 그 경계다.
   *
   * report_date 는 DATE 컬럼이라 문자열(YYYY-MM-DD)로 비교한다. Date 객체를 그대로 넘기면
   * 드라이버가 시각까지 붙인 값을 만들어 비교가 타임존에 따라 흔들린다.
   */
  private publicComments(reportDate: Date): Promise<{ beachId: number; comment: string }[]> {
    return this.db
      .selectFrom('daily_reports')
      .select(['beach_id as beachId', 'public_comment as comment'])
      // DATE 컬럼이라 문자열로 비교한다(값은 파라미터로 바인딩된다).
      .where(sql<boolean>`report_date = ${toKstDateString(reportDate)}`)
      .where('public_comment', 'is not', null)
      .execute() as Promise<{ beachId: number; comment: string }[]>;
  }
}

/** 해변별 산출 이력 → 처음/마지막/최고 단계. */
function foldRiskPoints(
  rows: { beachId: number; riskLevel: string }[],
): Map<number, { first: RiskLevel; last: RiskLevel; max: RiskLevel }> {
  const out = new Map<number, { first: RiskLevel; last: RiskLevel; max: RiskLevel }>();

  for (const row of rows) {
    // 계약에 없는 값은 버린다. 여기서 억지로 단계를 부여하면 화면이 조용히 거짓말을 한다.
    if (!isRiskLevel(row.riskLevel)) continue;

    const beachId = Number(row.beachId);
    const current = out.get(beachId);
    if (!current) {
      // 질의가 generated_at 오름차순이므로 처음 만난 것이 그날 첫 산출이다.
      out.set(beachId, { first: row.riskLevel, last: row.riskLevel, max: row.riskLevel });
      continue;
    }
    current.last = row.riskLevel;
    current.max = maxRiskLevel(current.max, row.riskLevel);
  }

  return out;
}
