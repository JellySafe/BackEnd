import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import { FieldObservation } from '../../../domain/field-observation';
import { StingIncident } from '../../../domain/sting-incident';
import { EvaluationOutcome, ObservationSource, StingSeverity } from '../../../domain/groundtruth-enums';
import { OutcomeCounts } from '../../../domain/prediction-outcome';

/**
 * groundtruth 아웃바운드 포트 모음.
 *
 * 포트를 파일 하나에 모은 이유: 이 컨텍스트의 아웃바운드는 전부 **같은 정답 데이터**를
 * 다루고 서로 붙어 다닌다(관측을 저장하는 곳과 그 관측을 세는 곳이 갈라지면 읽는 사람이
 * 두 파일을 오간다). 크기가 커지면 그때 나눈다.
 */

// ── 쓰기 ────────────────────────────────────────────────────────────────────────────

export interface FieldObservationRepositoryPort {
  /** 저장하고 부여된 id 를 돌려준다. */
  saveObservation(observation: FieldObservation): Promise<Id>;
}
export const FIELD_OBSERVATION_REPOSITORY = Symbol('FIELD_OBSERVATION_REPOSITORY');

export interface StingIncidentRepositoryPort {
  saveIncident(incident: StingIncident): Promise<Id>;
  /**
   * 같은 외부 식별자의 사고가 이미 있는지. 값이 없으면(null) 검사하지 않는다.
   * **자동 병합은 하지 않는다** — 중복 가능성만 알리고 판단은 사람이 한다.
   */
  existsByExternalRef(externalRef: string): Promise<boolean>;
}
export const STING_INCIDENT_REPOSITORY = Symbol('STING_INCIDENT_REPOSITORY');

// ── 조회 ────────────────────────────────────────────────────────────────────────────

export interface FieldObservationFilter {
  beachId?: Id;
  /** KST 날짜 키(포함). */
  from?: Date;
  to?: Date;
  source?: ObservationSource;
  /** true 면 출현한 관측만, false 면 부재 관측만. */
  jellyfishPresent?: boolean;
}

export interface FieldObservationRow {
  id: Id;
  beachId: Id;
  beachName: string;
  observedAt: Date;
  source: ObservationSource;
  observerName: string | null;
  jellyfishPresent: boolean;
  densityLevel: DensityLevel | null;
  speciesName: string | null;
  estimatedCount: number | null;
  note: string | null;
}

export interface StingIncidentRow {
  id: Id;
  beachId: Id;
  beachName: string;
  occurredAt: Date;
  source: string;
  severity: StingSeverity;
  patientCount: number;
  speciesName: string | null;
  externalRef: string | null;
  note: string | null;
}

/**
 * 대조 배치가 읽는 **하루치 실제 관측** 묶음.
 * `observed` 가 false 인 (해변, 날짜)는 관측이 한 건도 없었다는 뜻이다.
 */
export interface DailyActualRow {
  beachId: Id;
  /** KST 날짜 키. */
  targetDate: Date;
  observed: boolean;
  maxDensity: DensityLevel | null;
  incidentCount: number;
}

export interface GroundtruthQueryPort {
  listObservations(
    filter: FieldObservationFilter,
    page: PageRequest,
  ): Promise<Page<FieldObservationRow>>;

  listIncidents(
    filter: { beachId?: Id; from?: Date; to?: Date },
    page: PageRequest,
  ): Promise<Page<StingIncidentRow>>;

  /**
   * 기간 안의 (해변 × 날짜) 실제 관측·사고 집계.
   * 관측도 사고도 없는 (해변, 날짜)는 **행이 나오지 않는다** — 대조 대상이 아니기 때문이다.
   */
  collectDailyActuals(from: Date, to: Date): Promise<DailyActualRow[]>;
}
export const GROUNDTRUTH_QUERY = Symbol('GROUNDTRUTH_QUERY');

// ── 과거 예측 읽기 ──────────────────────────────────────────────────────────────────

/** 그날 그 해변의 예측 중 최고 단계. */
export interface DailyPredictionRow {
  beachId: Id;
  targetDate: Date;
  maxLevel: RiskLevel;
  maxScore: number;
  ruleVersion: string;
}

/**
 * 과거 위험도 예측을 읽는 포트.
 *
 * risk 컨텍스트의 조회 포트를 그대로 쓰지 않는 이유: 그쪽은 **현재 노출용**(is_latest)이라
 * 과거 시점의 예측을 돌려주지 않는다. 대조는 "그때 무엇을 보여줬는가" 를 물으므로 다른 질문이다.
 */
export interface RiskPredictionPort {
  /** 기간 안의 (해변 × 날짜) 최고 예측. horizon='now' 기준이다. */
  collectDailyPredictions(from: Date, to: Date): Promise<DailyPredictionRow[]>;
}
export const RISK_PREDICTION = Symbol('RISK_PREDICTION');

// ── 대조 결과 ───────────────────────────────────────────────────────────────────────

export interface EvaluationRecord {
  beachId: Id;
  targetDate: Date;
  predictedLevel: RiskLevel;
  predictedScore: number;
  observed: boolean;
  actualDensity: DensityLevel | null;
  incidentCount: number;
  outcome: EvaluationOutcome;
  alertThreshold: RiskLevel;
  ruleVersion: string;
}

export interface AccuracyFilter {
  from?: Date;
  to?: Date;
  beachId?: Id;
}

/** 해변별 정확도 집계 한 행. */
export interface BeachOutcomeCounts extends OutcomeCounts {
  beachId: Id;
  beachName: string;
}

/** 대조 결과 쓰기. */
export interface EvaluationRepositoryPort {
  /**
   * (해변, 날짜) 단위로 **덮어쓴다.** 관측·사고가 늦게 들어오는 일이 흔해 재평가가 정상
   * 동작이고, 그때마다 행이 쌓이면 집계가 중복된다.
   */
  upsertMany(records: EvaluationRecord[]): Promise<number>;
}
export const EVALUATION_REPOSITORY = Symbol('EVALUATION_REPOSITORY');

/**
 * 정확도 집계 조회.
 *
 * 쓰기(EvaluationRepositoryPort)와 나눈 이유는 이 저장소의 관례 그대로다 — 쓰기·트랜잭션은
 * Prisma, 집계는 Kysely 가 맡는다. 한 포트에 묶으면 어댑터 하나가 두 드라이버를 함께 들고
 * 있어야 한다.
 */
export interface AccuracyQueryPort {
  countOutcomes(filter: AccuracyFilter): Promise<OutcomeCounts>;
  countOutcomesByBeach(filter: AccuracyFilter): Promise<BeachOutcomeCounts[]>;
}
export const ACCURACY_QUERY = Symbol('ACCURACY_QUERY');

/** 하루치 관측 기록 현황 — 해변 한 곳. */
export interface BeachObservationCoverage {
  beachId: Id;
  beachName: string;
  region: string;
  /** 그날 이 해변에 기록이 하나라도 있는가. */
  recorded: boolean;
  /** 그날 마지막 기록 시각. 없으면 null. */
  lastObservedAt: Date | null;
  /**
   * 그날 마지막 기록의 판정(있었다/없었다). 기록이 없으면 null.
   *
   * **`false`(없었다)가 이 기능의 핵심이다.** 사람은 해파리를 봤을 때만 기록하고, 아무것도
   * 없던 날은 기록하지 않는다. 그런데 정확도를 재려면 그 "없었던 날"이 있어야 한다.
   */
  jellyfishPresent: boolean | null;
  /** 마지막 기록을 남긴 사람. */
  observerName: string | null;
}

/**
 * 하루치 관측 기록 현황 조회 포트.
 *
 * ── 왜 이게 필요한가 ─────────────────────────────────────────────────────────────────
 * 정답 데이터를 넣는 API 는 이미 있는데 **아무도 넣지 않아 빈 채로 돌고 있다.** 입력 폼이
 * 무거워서가 아니다(필수 항목이 넷뿐이다) — **오늘 무엇을 기록해야 하는지 아무도 모르기**
 * 때문이다.
 *
 * 그리고 사람이 자연스럽게 남기는 기록에는 **치우침이 있다.** 해파리를 봤을 때는 기록하지만
 * 아무것도 없던 날은 그냥 지나간다. 그러면 `correct_negative` 와 `false_alarm` 이 쌓이지
 * 않아 **오경보율을 영영 잴 수 없다.** 정확도 넷 중 둘이 비는 것이다.
 *
 * 그래서 "오늘 아직 기록되지 않은 해변" 을 목록으로 보여준다. 채우는 행위 자체가
 * **"없었다" 기록을 만들게 하는 것**이 이 조회의 목적이다.
 */
export interface ObservationCoverageQueryPort {
  /**
   * 그날(KST 하루)의 해변별 기록 현황.
   *
   * **기록이 없는 해변도 포함한다**(recorded=false 로). 그게 이 조회에서 가장 중요한 행이다 —
   * 빼 버리면 정작 채워야 할 곳이 목록에서 사라진다.
   */
  coverageFor(dateKey: Date): Promise<BeachObservationCoverage[]>;
}

export const OBSERVATION_COVERAGE_QUERY = Symbol('OBSERVATION_COVERAGE_QUERY');
