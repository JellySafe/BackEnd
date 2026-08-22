import { RiskLevel, compareRiskLevel } from '@shared/kernel/risk-level';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import { EvaluationOutcome } from './groundtruth-enums';

/**
 * 예측 대조 — **순수 도메인 로직.** 이 컨텍스트의 심장이다.
 *
 * "그날 그 해변에 경보를 냈는가" 와 "그날 그 해변이 실제로 위험했는가" 를 맞춰 본다.
 * 두 판정 모두 **정책**이고, 정책이므로 코드 한가운데 숨어 있으면 안 된다. 여기 모아 두고
 * 왜 그렇게 정했는지 적는다.
 */

/**
 * 대조의 단위 = **해변 × 하루**.
 *
 * 시점 단위로 맞추지 않는 이유: 현장 관측은 하루 두세 번이고 쏘임 사고는 시각이 부정확하게
 * 들어온다(119 기록은 신고 시각이지 쏘인 시각이 아니다). 예측은 30분마다 나오지만 그 해상도로
 * 정답을 만들 수 없으므로, **정답이 감당할 수 있는 가장 작은 단위**인 하루로 맞춘다.
 *
 * 하루 안에서 예측은 **최고 단계**를 대표값으로 쓴다. 안전 서비스에서 "오전에 한 번이라도
 * 위험을 알렸다" 면 그날은 경보한 날이기 때문이다(평균을 쓰면 짧고 강한 경보가 지워진다).
 */
export interface DailyPrediction {
  /** 그날 그 해변의 예측 중 가장 높은 단계. */
  maxLevel: RiskLevel;
  /** 그 단계일 때의 점수(0~100). 기록용이며 판정에는 쓰지 않는다. */
  maxScore: number;
}

/** 그날 그 해변에서 실제로 관측·기록된 것. */
export interface DailyActual {
  /**
   * 현장 관측이 한 건이라도 있었는가.
   *
   * **이 값이 false 면 그날은 대조 대상이 아니다.** 아무도 보지 않은 날을 "출현 없음" 으로
   * 세면 오경보가 실제보다 많아 보인다(관측이 없는 것과 없음을 확인한 것은 다르다).
   */
  observed: boolean;
  /** 관측된 최고 밀도. 출현이 없었으면 null. */
  maxDensity: DensityLevel | null;
  /** 그날 그 해변에서 확인된 쏘임 사고 건수. */
  incidentCount: number;
}

/**
 * **경보로 볼 최소 단계.** `danger` 이상을 경보로 본다.
 *
 * `caution`(주의)을 경보에 넣지 않는 이유: 주의는 "들어가도 되지만 살펴라" 는 뜻이라
 * 이용자의 행동을 바꾸지 않는다. 경보의 정의를 넓히면 hit 이 쉽게 늘어 지표가 좋아 보이지만,
 * 정작 사람들이 물에 들어가지 않게 만든 순간만 세는 것이 목적이므로 좁게 잡는다.
 *
 * ⚠️ 이 값을 바꾸면 과거 지표와 비교할 수 없다. 바꿀 때는 재평가(재계산)까지 함께 한다.
 */
export const ALERT_THRESHOLD: RiskLevel = 'danger';

/** 그날의 예측이 '경보' 였는가. */
export function isAlert(prediction: DailyPrediction): boolean {
  return compareRiskLevel(prediction.maxLevel, ALERT_THRESHOLD) >= 0;
}

/**
 * 그날이 실제로 **위험했는가**.
 *
 * ── 판정 규칙과 근거 ────────────────────────────────────────────────────────────────
 *   쏘임 사고 1건 이상  → 위험. 논쟁의 여지가 없다. 피해가 실제로 났다.
 *   고밀도·중밀도 출현  → 위험. 아직 사고가 없었을 뿐 입수하면 쏘일 수 있는 상태다.
 *   저밀도 출현        → 위험 아님. 해파리는 연안에 상시 조금씩 있다. 이걸 위험으로 세면
 *                        "거의 매일 위험" 이 되어 경보가 의미를 잃는다.
 *   출현 없음          → 위험 아님.
 *
 * 사고를 밀도보다 우선한다. 저밀도로 기록됐는데 사고가 났다면 **기록이 아니라 사고가 옳다** —
 * 관측은 특정 시각의 표본이고 사고는 실제로 일어난 일이기 때문이다.
 */
export function wasDangerous(actual: DailyActual): boolean {
  if (actual.incidentCount > 0) return true;
  return actual.maxDensity === 'high' || actual.maxDensity === 'medium';
}

/**
 * 예측과 실제를 맞춰 네 칸 중 하나로 판정한다.
 *
 * 관측이 없는 날(`observed === false`)은 사고가 있었을 때만 판정한다 — 사고는 그 자체로
 * "위험했다" 는 증거이므로 관측이 없어도 미경보를 셀 수 있다. 반대로 사고도 관측도 없는 날은
 * **아무것도 모르는 날**이라 판정하지 않는다(null).
 */
export function classifyOutcome(
  prediction: DailyPrediction,
  actual: DailyActual,
): EvaluationOutcome | null {
  if (!actual.observed && actual.incidentCount === 0) return null;

  const alerted = isAlert(prediction);
  const dangerous = wasDangerous(actual);

  if (alerted && dangerous) return 'hit';
  if (!alerted && dangerous) return 'miss';
  if (alerted && !dangerous) return 'false_alarm';
  return 'correct_negative';
}

/** 판정 결과 집계. */
export interface OutcomeCounts {
  hit: number;
  miss: number;
  false_alarm: number;
  correct_negative: number;
}

/**
 * 정확도 요약.
 *
 * 비율은 분모가 0 이면 **null 이다.** 0 으로 두면 "완벽함" 과 "잴 수 없음" 이 같은 값이 되어,
 * 데이터가 없는 초기에 지표가 좋아 보이는 착시가 생긴다(이 서비스에서 가장 피해야 할 종류의
 * 거짓 신호다).
 */
export interface AccuracySummary {
  counts: OutcomeCounts;
  /** 평가된 총 일수(해변 × 일). */
  total: number;
  /**
   * 재현율 = hit / (hit + miss). **위험했던 날 중 경보한 비율.**
   * 안전 서비스에서 가장 중요한 값이다 — 1 에서 이 값을 뺀 것이 곧 놓친 비율이다.
   */
  recall: number | null;
  /**
   * 정밀도 = hit / (hit + false_alarm). **경보한 날 중 실제로 위험했던 비율.**
   * 낮으면 경보가 잦아 무시당하기 시작한다.
   */
  precision: number | null;
  /**
   * 오경보율 = false_alarm / (false_alarm + correct_negative).
   * **안전했던 날 중 경보한 비율.** 알림 피로의 직접 지표다.
   */
  falseAlarmRate: number | null;
}

const EMPTY_COUNTS: OutcomeCounts = { hit: 0, miss: 0, false_alarm: 0, correct_negative: 0 };

/** 판정 목록을 세어 요약한다. */
export function summarize(outcomes: readonly EvaluationOutcome[]): AccuracySummary {
  const counts: OutcomeCounts = { ...EMPTY_COUNTS };
  for (const outcome of outcomes) counts[outcome] += 1;
  return summarizeCounts(counts);
}

/** 이미 집계된 건수로 요약한다(DB 에서 GROUP BY 로 세어 온 경우). */
export function summarizeCounts(counts: OutcomeCounts): AccuracySummary {
  const ratio = (numerator: number, denominator: number): number | null =>
    denominator === 0 ? null : numerator / denominator;

  return {
    counts,
    total: counts.hit + counts.miss + counts.false_alarm + counts.correct_negative,
    recall: ratio(counts.hit, counts.hit + counts.miss),
    precision: ratio(counts.hit, counts.hit + counts.false_alarm),
    falseAlarmRate: ratio(counts.false_alarm, counts.false_alarm + counts.correct_negative),
  };
}
