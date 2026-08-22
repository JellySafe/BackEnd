/**
 * groundtruth 컨텍스트 값 계약 (소문자). DB VARCHAR + CHECK 와 1:1 대응한다.
 *
 * ── 이 컨텍스트가 왜 있는가 ──────────────────────────────────────────────────────────
 * 지금까지 이 서비스는 **자기가 맞았는지 알 수 없는 구조**였다. 위험도는 `해변 × 시점` 단위로
 * 내는데, 검증에 쓴 정답은 국립수산과학원 주간보고의 `시군구 × 주` 단위다. 백테스트 문서가
 * 그 한계를 직접 적어 두었다(docs/backtest.md):
 *
 *   "해변별 변별력은 현재 어떤 룰도 만들어내지 못하고 있으며, 이 백테스트로는 검증할 수도
 *    없다(정답이 광역 단위라서). 해변 단위 예측을 주장하려면 해변 단위 정답 데이터(현장
 *    관찰 일지, 안전요원 기록)가 필요하다."
 *
 * 이 컨텍스트가 그 정답을 모은다. 두 종류다.
 *   1. **현장 관측**(field_observations) — 안전요원·운영기관이 직접 본 것.
 *   2. **쏘임 사고**(sting_incidents)     — 실제로 일어난 피해. 가장 강한 정답이다.
 *
 * 그리고 과거 예측과 대조해 맞았는지 센다(prediction_evaluations).
 */

/**
 * 현장 관측의 출처. **누가 봤는가에 따라 신뢰도가 다르다.**
 *
 * 시민 제보(report 컨텍스트)와 섞지 않는다. 시민 제보는 "본 사람이 올린 것" 이라 없을 때는
 * 아무도 올리지 않는다 — 즉 **부재를 알 수 없다.** 정답 데이터로는 반쪽이다.
 * 현장 관측은 정해진 시각에 정해진 사람이 "있었다/없었다" 를 모두 기록한다. 그 차이가 크다.
 */
export const OBSERVATION_SOURCES = [
  'lifeguard', // 해수욕장 안전요원 정기 관측
  'official', // 지자체·운영기관 점검
  'partner', // 협약 기관(어촌계·다이빙샵 등)
] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export function isObservationSource(v: unknown): v is ObservationSource {
  return typeof v === 'string' && (OBSERVATION_SOURCES as readonly string[]).includes(v);
}

/**
 * 쏘임 사고를 알려온 경로.
 *
 * `emergency_call`(119)·`coast_guard`(해경)는 외부 기관 연계로 들어오는 값이고, 나머지는
 * 우리 쪽에서 입력한다. 출처를 남기는 이유는 **집계에서 중복을 걸러야** 하기 때문이다 —
 * 같은 사고가 안전요원과 119 양쪽에서 들어올 수 있다(external_ref 로 묶는다).
 */
export const INCIDENT_SOURCES = [
  'emergency_call', // 119 구급 출동
  'coast_guard', // 해양경찰
  'lifeguard', // 해수욕장 안전요원
  'hospital', // 의료기관 신고
  'self_report', // 피해자 직접 신고
] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export function isIncidentSource(v: unknown): v is IncidentSource {
  return typeof v === 'string' && (INCIDENT_SOURCES as readonly string[]).includes(v);
}

/**
 * 쏘임 피해 정도.
 *
 * 의학적 중증도 분류가 아니라 **운영 판단에 필요한 최소 구분**이다. 정확한 진단은 의료기관의
 * 몫이고, 우리가 그것을 흉내 내면 기록이 진료 기록처럼 읽힌다.
 */
export const STING_SEVERITIES = [
  'mild', // 현장 처치로 종결
  'moderate', // 병원 이송
  'severe', // 입원·중환자
  'fatal', // 사망
] as const;
export type StingSeverity = (typeof STING_SEVERITIES)[number];

export function isStingSeverity(v: unknown): v is StingSeverity {
  return typeof v === 'string' && (STING_SEVERITIES as readonly string[]).includes(v);
}

/**
 * 예측 대조 결과 (혼동 행렬의 네 칸).
 *
 * ── 네 값의 무게가 같지 않다 ────────────────────────────────────────────────────────
 *   miss          경보하지 않았는데 위험했다  ← **가장 나쁘다.** 서비스가 존재하지 않은 것보다
 *                                             나쁘다. 사용자가 "안전하다" 를 믿고 들어갔기 때문이다.
 *   false_alarm   경보했는데 안전했다        ← 한 번은 괜찮다. 그런데 잦으면 사람들이 무시하게
 *                                             되고, 그러면 결국 miss 와 같은 결과가 된다.
 *   hit           경보했고 위험했다          ← 서비스가 일한 순간.
 *   correct_negative 경보 안 했고 안전했다   ← 대부분의 날. 이 값이 있어야 오경보율을 잴 수 있다.
 *
 * 그래서 **하나의 지표로 품질을 말할 수 없다.** 미경보를 0 으로 만들려면 항상 경보하면 되고,
 * 오경보를 0 으로 만들려면 절대 경보하지 않으면 된다. 둘을 같이 봐야 한다.
 */
export const EVALUATION_OUTCOMES = ['hit', 'miss', 'false_alarm', 'correct_negative'] as const;
export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];

export function isEvaluationOutcome(v: unknown): v is EvaluationOutcome {
  return typeof v === 'string' && (EVALUATION_OUTCOMES as readonly string[]).includes(v);
}
