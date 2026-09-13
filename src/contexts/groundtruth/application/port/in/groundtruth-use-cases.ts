import { Id } from '@shared/kernel/id';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { RiskLevel } from '@shared/kernel/risk-level';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import { AccuracySummary } from '../../../domain/prediction-outcome';
import { IncidentSource, ObservationSource, StingSeverity } from '../../../domain/groundtruth-enums';
import {
  BeachOutcomeCounts,
  FieldObservationFilter,
  FieldObservationRow,
  StingIncidentRow,
} from '../out/groundtruth-ports';

// ── 현장 관측 기록 ──────────────────────────────────────────────────────────────────

export interface RecordFieldObservationCommand {
  beachId: Id;
  observedAt: Date;
  source: ObservationSource;
  jellyfishPresent: boolean;
  densityLevel?: DensityLevel | null;
  speciesId?: Id | null;
  estimatedCount?: number | null;
  observerName?: string | null;
  note?: string | null;
  /** 기록한 관리자/운영자. 인증에서만 나온다. */
  observerId: Id | null;
}

export interface RecordFieldObservationResult {
  observationId: Id;
}

export interface RecordFieldObservationUseCase {
  recordObservation(
    command: RecordFieldObservationCommand,
  ): Promise<RecordFieldObservationResult>;
}
export const RECORD_FIELD_OBSERVATION_USE_CASE = Symbol('RECORD_FIELD_OBSERVATION_USE_CASE');

// ── 쏘임 사고 기록 ──────────────────────────────────────────────────────────────────

export interface RecordStingIncidentCommand {
  beachId: Id;
  occurredAt: Date;
  source: IncidentSource;
  severity: StingSeverity;
  patientCount: number;
  speciesId?: Id | null;
  externalRef?: string | null;
  note?: string | null;
  reportedBy: Id | null;
}

export interface RecordStingIncidentResult {
  incidentId: Id;
  /**
   * 같은 외부 식별자의 사고가 이미 있었는가.
   *
   * **저장은 그대로 한다.** 기계가 병합하면 시각·인원이 조금씩 다른 두 기록이 합쳐지면서
   * 사고 건수가 조용히 줄어든다. 대신 이 표시를 올려 사람이 확인하게 한다.
   */
  possibleDuplicate: boolean;
}

export interface RecordStingIncidentUseCase {
  recordIncident(command: RecordStingIncidentCommand): Promise<RecordStingIncidentResult>;
}
export const RECORD_STING_INCIDENT_USE_CASE = Symbol('RECORD_STING_INCIDENT_USE_CASE');

// ── 목록 조회 ───────────────────────────────────────────────────────────────────────

export interface ListGroundtruthUseCase {
  listObservations(
    filter: FieldObservationFilter,
    page: PageRequest,
  ): Promise<Page<FieldObservationRow>>;
  listIncidents(
    filter: { beachId?: Id; from?: Date; to?: Date },
    page: PageRequest,
  ): Promise<Page<StingIncidentRow>>;
}
export const LIST_GROUNDTRUTH_USE_CASE = Symbol('LIST_GROUNDTRUTH_USE_CASE');

// ── 예측 대조 ───────────────────────────────────────────────────────────────────────

export interface EvaluatePredictionsCommand {
  /** KST 날짜 키(포함). 미지정 시 어제 하루. */
  from?: Date;
  to?: Date;
}

export interface EvaluatePredictionsResult {
  /** 평가한 (해변 × 날짜) 수. */
  evaluated: number;
  /** 예측은 있는데 관측·사고가 없어 판정하지 못한 (해변 × 날짜) 수. */
  skippedNoActual: number;
  /** 관측은 있는데 그날 예측이 없어 판정하지 못한 수(배치가 멎었던 기간). */
  skippedNoPrediction: number;
  summary: AccuracySummary;
}

export interface EvaluatePredictionsUseCase {
  evaluate(command: EvaluatePredictionsCommand): Promise<EvaluatePredictionsResult>;
}
export const EVALUATE_PREDICTIONS_USE_CASE = Symbol('EVALUATE_PREDICTIONS_USE_CASE');

// ── 정확도 조회 ─────────────────────────────────────────────────────────────────────

export interface AccuracyReport {
  overall: AccuracySummary;
  /**
   * 해변별 요약. **해변 단위 변별력을 보는 유일한 창**이다(docs/backtest.md 의 미해결 과제).
   *
   * ⚠️ 시군구 단위 정답(좌표 없는 출현)은 **여기 들어오지 않는다.** 넣으면 같은 시의 해변이
   * 전부 같은 판정을 받아 변별력이라는 이 목록의 존재 이유가 사라진다. 그래서 현장 관측이
   * 쌓이기 전까지 이 목록은 대부분 비어 있고, 그게 정직한 상태다.
   */
  byBeach: (BeachOutcomeCounts & { summary: AccuracySummary })[];
  /**
   * `overall` 에 섞인 시군구 단위 정답 건수.
   *
   * 전체 정확도를 해변 단위로 잰 값으로 오해하지 않으려면 이 숫자를 함께 봐야 한다.
   * `overall.total` 과 같다면 **해변 단위 증거는 하나도 없다는 뜻**이다.
   */
  regionLevelSamples: number;
  /** 판정에 쓴 경보 임계선. 이 값이 다르면 다른 기간과 비교할 수 없다. */
  alertThreshold: RiskLevel;
  from: Date | null;
  to: Date | null;
}

export interface GetAccuracyUseCase {
  getReport(filter: { from?: Date; to?: Date; beachId?: Id }): Promise<AccuracyReport>;
}
export const GET_ACCURACY_USE_CASE = Symbol('GET_ACCURACY_USE_CASE');
