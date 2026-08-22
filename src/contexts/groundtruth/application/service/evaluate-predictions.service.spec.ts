import { parseKstDateKey } from '@shared/kernel/kst-date';
import { EvaluatePredictionsService } from './evaluate-predictions.service';
import {
  DailyActualRow,
  DailyPredictionRow,
  EvaluationRecord,
} from '../port/out/groundtruth-ports';

/**
 * 대조 배치의 **조합 로직**을 본다. 판정 자체는 도메인이 하고(prediction-outcome.spec),
 * 여기서 지키는 것은 "무엇을 맞추고 무엇을 건너뛰는가" 다.
 *
 * 특히 두 건너뜀을 구분해 세는 것이 중요하다.
 *  - 관측이 없다 → 지표 문제가 아니다(아무도 안 본 날).
 *  - 예측이 없다 → **운영 문제다**(그 기간 산출 배치가 멎어 있었다). 조용히 넘기면
 *    "평가 대상이 원래 적었나 보다" 로 읽힌다.
 */
describe('EvaluatePredictionsService', () => {
  const DAY1 = parseKstDateKey('2026-08-18');
  const DAY2 = parseKstDateKey('2026-08-19');

  function build(options: {
    predictions: DailyPredictionRow[];
    actuals: DailyActualRow[];
  }): { service: EvaluatePredictionsService; upserted: EvaluationRecord[][] } {
    const upserted: EvaluationRecord[][] = [];

    const service = new EvaluatePredictionsService(
      {
        collectDailyActuals: () => Promise.resolve(options.actuals),
        listObservations: jest.fn(),
        listIncidents: jest.fn(),
      },
      { collectDailyPredictions: () => Promise.resolve(options.predictions) },
      {
        upsertMany: (records) => {
          upserted.push(records);
          return Promise.resolve(records.length);
        },
      },
    );

    return { service, upserted };
  }

  const prediction = (over: Partial<DailyPredictionRow> = {}): DailyPredictionRow => ({
    beachId: 1,
    targetDate: DAY1,
    maxLevel: 'safe',
    maxScore: 10,
    ruleVersion: 'v3',
    ...over,
  });

  const actualRow = (over: Partial<DailyActualRow> = {}): DailyActualRow => ({
    beachId: 1,
    targetDate: DAY1,
    observed: true,
    maxDensity: null,
    incidentCount: 0,
    ...over,
  });

  it('예측과 실제가 맞는 (해변, 날짜)를 판정해 저장한다', async () => {
    const { service, upserted } = build({
      predictions: [prediction({ maxLevel: 'danger', maxScore: 60 })],
      actuals: [actualRow({ maxDensity: 'high' })],
    });

    const result = await service.evaluate({ from: DAY1, to: DAY1 });

    expect(result.evaluated).toBe(1);
    expect(result.summary.counts.hit).toBe(1);
    expect(upserted[0][0]).toMatchObject({
      beachId: 1,
      outcome: 'hit',
      predictedLevel: 'danger',
      predictedScore: 60,
      ruleVersion: 'v3',
    });
  });

  it('판정에 쓴 경보 임계선을 행에 남긴다 — 정책이 바뀌어도 과거를 해석할 수 있어야 한다', async () => {
    const { service, upserted } = build({
      predictions: [prediction()],
      actuals: [actualRow()],
    });

    await service.evaluate({ from: DAY1, to: DAY1 });
    expect(upserted[0][0].alertThreshold).toBe('danger');
  });

  describe('건너뛴 경우를 구분해 센다', () => {
    it('예측은 있는데 관측·사고가 없으면 skippedNoActual 이다', async () => {
      const { service, upserted } = build({ predictions: [prediction()], actuals: [] });

      const result = await service.evaluate({ from: DAY1, to: DAY1 });

      expect(result.evaluated).toBe(0);
      expect(result.skippedNoActual).toBe(1);
      expect(upserted).toHaveLength(0); // 저장할 것이 없으면 쓰기도 하지 않는다
    });

    it('관측은 있는데 그날 예측이 없으면 skippedNoPrediction 이다 — 산출 배치가 멎었다는 신호', async () => {
      const { service } = build({ predictions: [], actuals: [actualRow()] });

      const result = await service.evaluate({ from: DAY1, to: DAY1 });

      expect(result.evaluated).toBe(0);
      expect(result.skippedNoPrediction).toBe(1);
    });

    it('관측 기록은 있지만 출현·사고가 없어 판정 불가한 경우도 skippedNoActual 이다', async () => {
      // observed=false 이고 사고도 0 이면 도메인이 null 을 준다(아무것도 모르는 날).
      const { service } = build({
        predictions: [prediction()],
        actuals: [actualRow({ observed: false, incidentCount: 0 })],
      });

      const result = await service.evaluate({ from: DAY1, to: DAY1 });
      expect(result.evaluated).toBe(0);
      expect(result.skippedNoActual).toBe(1);
    });
  });

  it('해변과 날짜가 모두 같아야 맞춘다', async () => {
    const { service } = build({
      predictions: [prediction({ beachId: 1, targetDate: DAY1 })],
      // 같은 날 다른 해변, 같은 해변 다른 날 — 둘 다 짝이 아니다.
      actuals: [
        actualRow({ beachId: 2, targetDate: DAY1 }),
        actualRow({ beachId: 1, targetDate: DAY2 }),
      ],
    });

    const result = await service.evaluate({ from: DAY1, to: DAY2 });

    expect(result.evaluated).toBe(0);
    expect(result.skippedNoActual).toBe(1);
    expect(result.skippedNoPrediction).toBe(2);
  });

  it('여러 해변·여러 날을 한 번에 판정한다', async () => {
    const { service } = build({
      predictions: [
        prediction({ beachId: 1, targetDate: DAY1, maxLevel: 'danger' }),
        prediction({ beachId: 2, targetDate: DAY1, maxLevel: 'safe' }),
        prediction({ beachId: 1, targetDate: DAY2, maxLevel: 'safe' }),
      ],
      actuals: [
        actualRow({ beachId: 1, targetDate: DAY1, maxDensity: 'high' }), // hit
        actualRow({ beachId: 2, targetDate: DAY1 }), // correct_negative
        actualRow({ beachId: 1, targetDate: DAY2, incidentCount: 1 }), // miss
      ],
    });

    const result = await service.evaluate({ from: DAY1, to: DAY2 });

    expect(result.evaluated).toBe(3);
    expect(result.summary.counts).toEqual({
      hit: 1,
      miss: 1,
      false_alarm: 0,
      correct_negative: 1,
    });
  });

  it('기간을 주지 않으면 어제 하루를 본다 — 오늘은 관측이 아직 다 안 들어왔다', async () => {
    let requested: { from: Date; to: Date } | null = null;
    const service = new EvaluatePredictionsService(
      {
        collectDailyActuals: (from, to) => {
          requested = { from, to };
          return Promise.resolve([]);
        },
        listObservations: jest.fn(),
        listIncidents: jest.fn(),
      },
      { collectDailyPredictions: () => Promise.resolve([]) },
      { upsertMany: () => Promise.resolve(0) },
    );

    await service.evaluate({});

    expect(requested).not.toBeNull();
    const { from, to } = requested as unknown as { from: Date; to: Date };
    expect(from.getTime()).toBe(to.getTime()); // 하루치
    // 어제여야 한다(오늘보다 이르다).
    expect(from.getTime()).toBeLessThan(Date.now());
  });
});
