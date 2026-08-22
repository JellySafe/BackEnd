import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { IncidentSource, StingSeverity, isIncidentSource, isStingSeverity } from './groundtruth-enums';

export interface StingIncidentProps {
  id?: Id;
  beachId: Id;
  occurredAt: Date;
  source: IncidentSource;
  severity: StingSeverity;
  patientCount: number;
  speciesId: Id | null;
  /** 외부 기관 시스템의 사건 식별자. 같은 사고가 두 경로로 들어올 때 묶는 열쇠다. */
  externalRef: string | null;
  note: string | null;
  reportedBy: Id | null;
  createdAt?: Date;
}

export interface NewStingIncidentInput {
  beachId: Id;
  occurredAt: Date;
  source: IncidentSource;
  severity: StingSeverity;
  patientCount: number;
  speciesId?: Id | null;
  externalRef?: string | null;
  note?: string | null;
  reportedBy?: Id | null;
}

const NOTE_MAX = 500;
const EXTERNAL_REF_MAX = 100;
/** 한 사건의 환자 수 상한. 이보다 크면 집계 값을 잘못 넣은 것이다. */
const PATIENT_MAX = 1_000;

/**
 * 쏘임 사고 기록 애그리거트.
 *
 * ── 이 데이터가 가장 강한 정답이다 ──────────────────────────────────────────────────
 * 현장 관측은 "위험해 보였다" 이고 이건 **실제로 피해가 났다** 이다. 예측이 맞았는지 따질 때
 * 다른 무엇보다 이 기록이 먼저다(prediction-outcome.ts 의 `wasDangerous` 가 밀도보다
 * 사고를 우선하는 이유).
 *
 * ── 개인정보를 담지 않는다 ──────────────────────────────────────────────────────────
 * 환자의 이름·연락처·상세 상병은 **받지 않는다.** 우리에게 필요한 것은 "그날 그 해변에서
 * 몇 명이 얼마나 다쳤는가" 뿐이고, 그 이상은 보관할 근거가 없다. 119·의료기관에서 연계될 때도
 * 이 스키마 밖의 값은 버린다 — 스키마에 없으면 실수로도 들어오지 않는다.
 *
 * ── 중복 유입 ───────────────────────────────────────────────────────────────────────
 * 같은 사고가 안전요원과 119 양쪽에서 들어올 수 있다. `externalRef` 가 있으면 그것으로 묶고,
 * 없으면 사람이 판단한다. **자동 병합은 하지 않는다** — 시각과 인원이 조금씩 다른 두 기록을
 * 기계가 합치면 사고 건수가 조용히 줄어든다.
 */
export class StingIncident {
  private constructor(private readonly props: StingIncidentProps) {}

  static create(input: NewStingIncidentInput, now: Date): StingIncident {
    if (!input.beachId || input.beachId <= 0) {
      throw new ValidationError('STING_BEACH_REQUIRED', '사고 발생 해변이 필요합니다.');
    }
    if (!isIncidentSource(input.source)) {
      throw new ValidationError('STING_SOURCE_INVALID', '허용되지 않은 신고 경로입니다.', {
        source: input.source,
      });
    }
    if (!isStingSeverity(input.severity)) {
      throw new ValidationError('STING_SEVERITY_INVALID', '허용되지 않은 피해 정도입니다.', {
        severity: input.severity,
      });
    }
    if (!(input.occurredAt instanceof Date) || Number.isNaN(input.occurredAt.getTime())) {
      throw new ValidationError('STING_TIME_INVALID', '사고 시각이 올바르지 않습니다.');
    }
    if (input.occurredAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new ValidationError('STING_TIME_FUTURE', '미래 시각의 사고는 기록할 수 없습니다.', {
        occurredAt: input.occurredAt.toISOString(),
      });
    }

    // 0명짜리 사고는 사고가 아니다. 그런 행이 들어오면 "사고가 있었다" 로 세어져
    // 그날이 위험했던 것으로 판정된다(prediction-outcome).
    if (!Number.isInteger(input.patientCount) || input.patientCount < 1) {
      throw new ValidationError('STING_PATIENT_REQUIRED', '피해자 수는 1명 이상이어야 합니다.', {
        patientCount: input.patientCount,
      });
    }
    if (input.patientCount > PATIENT_MAX) {
      throw new ValidationError('STING_PATIENT_RANGE', '피해자 수가 비정상적으로 큽니다.', {
        patientCount: input.patientCount,
      });
    }

    const note = input.note?.trim() ? input.note.trim() : null;
    if (note !== null && note.length > NOTE_MAX) {
      throw new ValidationError('STING_NOTE_TOO_LONG', '메모가 너무 깁니다.');
    }
    const externalRef = input.externalRef?.trim() ? input.externalRef.trim() : null;
    if (externalRef !== null && externalRef.length > EXTERNAL_REF_MAX) {
      throw new ValidationError('STING_EXTERNAL_REF_TOO_LONG', '외부 식별자가 너무 깁니다.');
    }

    return new StingIncident({
      beachId: input.beachId,
      occurredAt: input.occurredAt,
      source: input.source,
      severity: input.severity,
      patientCount: input.patientCount,
      speciesId: input.speciesId ?? null,
      externalRef,
      note,
      reportedBy: input.reportedBy ?? null,
      createdAt: now,
    });
  }

  static reconstitute(props: StingIncidentProps): StingIncident {
    return new StingIncident(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id {
    return this.props.beachId;
  }
  get patientCount(): number {
    return this.props.patientCount;
  }
  get severity(): StingSeverity {
    return this.props.severity;
  }
  get externalRef(): string | null {
    return this.props.externalRef;
  }

  snapshot(): Readonly<StingIncidentProps> {
    return { ...this.props };
  }
}
