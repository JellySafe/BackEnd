import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { AccuracyReport, GetAccuracyUseCase } from '../port/in/groundtruth-use-cases';
import { ACCURACY_QUERY, AccuracyQueryPort } from '../port/out/groundtruth-ports';
import { ALERT_THRESHOLD, summarizeCounts } from '../../domain/prediction-outcome';

/**
 * 정확도 보고 (ADM — 운영자가 "이 서비스가 맞고 있나" 를 보는 화면).
 *
 * ── 해변별 요약이 이 보고의 핵심이다 ────────────────────────────────────────────────
 * 전체 재현율은 예전 백테스트로도 대충 알 수 있었다. 알 수 **없었던** 것은 해변 사이의
 * 변별력이다 — 정답이 시군구 단위라 협재와 함덕을 구분할 방법이 없었다(docs/backtest.md).
 * 해변별로 나눠 보여주는 이 목록이 그 질문에 답하는 유일한 창이다.
 *
 * 비율 계산은 도메인이 한다. 여기서는 DB 가 세어 온 네 칸을 그대로 넘길 뿐이다 —
 * 분모가 0 일 때 null 을 주는 규칙이 두 곳에 생기면 반드시 어긋난다.
 */
@Injectable()
export class GetAccuracyService implements GetAccuracyUseCase {
  constructor(
    @Inject(ACCURACY_QUERY) private readonly evaluations: AccuracyQueryPort,
  ) {}

  async getReport(filter: { from?: Date; to?: Date; beachId?: Id }): Promise<AccuracyReport> {
    const [overallCounts, byBeachCounts] = await Promise.all([
      this.evaluations.countOutcomes(filter),
      this.evaluations.countOutcomesByBeach(filter),
    ]);

    return {
      overall: summarizeCounts(overallCounts),
      byBeach: byBeachCounts.map((row) => ({
        ...row,
        summary: summarizeCounts({
          hit: row.hit,
          miss: row.miss,
          false_alarm: row.false_alarm,
          correct_negative: row.correct_negative,
        }),
      })),
      // 어떤 임계선으로 판정한 값인지 함께 준다. 이게 다르면 다른 기간과 비교할 수 없다.
      alertThreshold: ALERT_THRESHOLD,
      from: filter.from ?? null,
      to: filter.to ?? null,
    };
  }
}
