import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { kstYesterday, toKstDateString } from '@shared/kernel/kst-date';
import {
  EvaluatePredictionsCommand,
  EvaluatePredictionsResult,
  EvaluatePredictionsUseCase,
} from '../port/in/groundtruth-use-cases';
import {
  DailyActualRow,
  DailyPredictionRow,
  EVALUATION_REPOSITORY,
  EvaluationRecord,
  EvaluationRepositoryPort,
  GROUNDTRUTH_QUERY,
  GroundtruthQueryPort,
  RISK_PREDICTION,
  RiskPredictionPort,
} from '../port/out/groundtruth-ports';
import { ALERT_THRESHOLD, classifyOutcome, summarize } from '../../domain/prediction-outcome';
import { EvaluationOutcome } from '../../domain/groundtruth-enums';

/**
 * 예측 대조 배치.
 *
 * ── 하는 일 ─────────────────────────────────────────────────────────────────────────
 * 기간 안의 (해변 × 날짜)마다 **그때 무엇을 보여줬는가**(예측)와 **실제로 어땠는가**(관측·사고)를
 * 맞춰 네 칸 중 하나로 판정하고 저장한다.
 *
 * ── 왜 어제까지만 도는가 ────────────────────────────────────────────────────────────
 * 기본 대상이 **어제 하루**다. 오늘은 아직 관측이 다 들어오지 않았고, 그 상태로 판정하면
 * 오후에 들어올 관측 때문에 오경보로 잘못 세어진다. 늦게 들어오는 기록은 재평가로 흡수한다
 * (같은 (해변, 날짜)는 덮어쓴다).
 *
 * ── 판정하지 않는 두 경우를 구분해 센다 ─────────────────────────────────────────────
 *  - 예측은 있는데 실제가 없다 → 아무도 안 본 날. **판정하지 않는다.**
 *    "관측이 없음" 을 "해파리 없음" 으로 세면 오경보가 실제보다 많아 보인다.
 *  - 실제는 있는데 예측이 없다 → 그 기간 산출 배치가 멎어 있었다는 뜻이다. 지표가 아니라
 *    **운영 문제**이므로 따로 세어 로그로 드러낸다(조용히 0건이 되면 원인을 알 수 없다).
 */
@Injectable()
export class EvaluatePredictionsService implements EvaluatePredictionsUseCase {
  private readonly logger = new Logger(EvaluatePredictionsService.name);

  constructor(
    @Inject(GROUNDTRUTH_QUERY) private readonly groundtruth: GroundtruthQueryPort,
    @Inject(RISK_PREDICTION) private readonly predictions: RiskPredictionPort,
    @Inject(EVALUATION_REPOSITORY) private readonly evaluations: EvaluationRepositoryPort,
  ) {}

  async evaluate(command: EvaluatePredictionsCommand): Promise<EvaluatePredictionsResult> {
    const yesterday = kstYesterday();
    const from = command.from ?? yesterday;
    const to = command.to ?? from;

    const [actuals, predicted] = await Promise.all([
      this.groundtruth.collectDailyActuals(from, to),
      this.predictions.collectDailyPredictions(from, to),
    ]);

    const predictionByKey = new Map(predicted.map((p) => [keyOf(p.beachId, p.targetDate), p]));
    const actualByKey = new Map(actuals.map((a) => [keyOf(a.beachId, a.targetDate), a]));

    const records: EvaluationRecord[] = [];
    const outcomes: EvaluationOutcome[] = [];
    let skippedNoActual = 0;

    for (const [key, prediction] of predictionByKey) {
      const actual = actualByKey.get(key);
      if (actual === undefined) {
        // 그날 그 해변을 아무도 보지 않았다. 대조 대상이 아니다.
        skippedNoActual += 1;
        continue;
      }

      const record = this.toRecord(prediction, actual);
      if (record === null) {
        skippedNoActual += 1;
        continue;
      }
      records.push(record);
      outcomes.push(record.outcome);
    }

    // 실제는 있는데 예측이 없는 (해변 × 날짜). 위험도 산출이 멎어 있었다는 신호다.
    const skippedNoPrediction = actuals.filter(
      (a) => !predictionByKey.has(keyOf(a.beachId, a.targetDate)),
    ).length;

    if (records.length > 0) {
      await this.evaluations.upsertMany(records);
    }

    const summary = summarize(outcomes);
    this.logger.log(
      `예측 대조 완료 (${toKstDateString(from)}~${toKstDateString(to)}): ` +
        `평가 ${records.length}건, 관측없음 ${skippedNoActual}건, 예측없음 ${skippedNoPrediction}건, ` +
        `hit ${summary.counts.hit} / miss ${summary.counts.miss} / ` +
        `오경보 ${summary.counts.false_alarm} / 정탐음성 ${summary.counts.correct_negative}`,
    );

    if (skippedNoPrediction > 0) {
      // 지표 문제가 아니라 운영 문제다. 조용히 넘기면 "평가 대상이 원래 적었나 보다" 로 읽힌다.
      this.logger.warn(
        `실제 관측은 있는데 그날 위험도 예측이 없는 경우 ${skippedNoPrediction}건 — ` +
          '그 기간 산출 배치가 멎어 있었는지 확인한다.',
      );
    }
    if (summary.counts.miss > 0) {
      // 미경보는 이 서비스가 가장 피해야 할 결과다. 집계에 묻히지 않게 따로 남긴다.
      this.logger.warn(
        `미경보(miss) ${summary.counts.miss}건 — 위험했는데 경보하지 않은 날이다. ` +
          '룰 재조정 대상인지 확인한다.',
      );
    }

    return { evaluated: records.length, skippedNoActual, skippedNoPrediction, summary };
  }

  /** 한 (해변, 날짜)를 판정해 저장 레코드로. 판정 불가면 null. */
  private toRecord(
    prediction: DailyPredictionRow,
    actual: DailyActualRow,
  ): EvaluationRecord | null {
    const outcome = classifyOutcome(
      { maxLevel: prediction.maxLevel, maxScore: prediction.maxScore },
      {
        observed: actual.observed,
        maxDensity: actual.maxDensity,
        incidentCount: actual.incidentCount,
      },
    );
    if (outcome === null) return null;

    return {
      beachId: prediction.beachId,
      targetDate: prediction.targetDate,
      predictedLevel: prediction.maxLevel,
      predictedScore: prediction.maxScore,
      observed: actual.observed,
      actualDensity: actual.maxDensity,
      incidentCount: actual.incidentCount,
      outcome,
      // 판정 정책을 행에 박아 둔다. 나중에 임계선을 바꿔도 과거 판정을 해석할 수 있어야 한다.
      alertThreshold: ALERT_THRESHOLD,
      ruleVersion: prediction.ruleVersion,
    };
  }
}

/** (해변, 날짜) 합성 키. 날짜는 KST 자정 UTC 인스턴트라 밀리초로 비교해도 안전하다. */
function keyOf(beachId: Id, date: Date): string {
  return `${beachId}:${date.getTime()}`;
}
