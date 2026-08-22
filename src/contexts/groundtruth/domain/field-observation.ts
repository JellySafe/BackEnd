import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { DensityLevel, isDensityLevel } from '@contexts/observation/domain/observation-enums';
import { ObservationSource, isObservationSource } from './groundtruth-enums';

export interface FieldObservationProps {
  id?: Id;
  beachId: Id;
  observedAt: Date;
  source: ObservationSource;
  observerId: Id | null;
  observerName: string | null;
  /** 해파리를 봤는가. **false 도 기록한다** — 아래 주석 참고. */
  jellyfishPresent: boolean;
  densityLevel: DensityLevel | null;
  speciesId: Id | null;
  estimatedCount: number | null;
  note: string | null;
  createdAt?: Date;
}

export interface NewFieldObservationInput {
  beachId: Id;
  observedAt: Date;
  source: ObservationSource;
  jellyfishPresent: boolean;
  observerId?: Id | null;
  observerName?: string | null;
  densityLevel?: DensityLevel | null;
  speciesId?: Id | null;
  estimatedCount?: number | null;
  note?: string | null;
}

const NOTE_MAX = 500;
const OBSERVER_NAME_MAX = 50;
/** 눈으로 세는 값이라 정밀할 수 없다. 상한은 "입력 실수" 를 걸러내는 선이다. */
const COUNT_MAX = 100_000;

/**
 * 현장 관측 기록 애그리거트.
 *
 * ── **부재 관측이 이 애그리거트의 존재 이유다** ──────────────────────────────────────
 * 시민 제보(report)는 본 사람만 올린다. 그래서 "제보가 없다" 가 "해파리가 없다" 를 뜻하지
 * 않는다 — 아무도 안 봤을 수도, 봤는데 안 올렸을 수도 있다. 그 데이터로는 **오경보를 셀 수
 * 없다.** 경보했는데 실제로 안전했는지 확인할 방법이 없기 때문이다.
 *
 * 현장 관측은 정해진 사람이 정해진 시각에 **"있었다/없었다" 를 모두** 기록한다.
 * `jellyfishPresent = false` 인 행이 정답 데이터의 절반이고, 그것이 없으면 이 서비스는
 * 영원히 자기 오경보율을 모른다.
 *
 * 그래서 불변식도 그 방향으로 잡는다 — **없었다고 하면서 밀도를 적을 수 없고, 있었다고
 * 하면서 밀도를 비울 수 없다.** 둘 다 나중에 집계에서 조용히 잘못 세어지는 형태다.
 */
export class FieldObservation {
  private constructor(private readonly props: FieldObservationProps) {}

  static create(input: NewFieldObservationInput, now: Date): FieldObservation {
    if (!input.beachId || input.beachId <= 0) {
      throw new ValidationError('FIELD_OBS_BEACH_REQUIRED', '관측 대상 해변이 필요합니다.');
    }
    if (!isObservationSource(input.source)) {
      throw new ValidationError('FIELD_OBS_SOURCE_INVALID', '허용되지 않은 관측 출처입니다.', {
        source: input.source,
      });
    }
    if (!(input.observedAt instanceof Date) || Number.isNaN(input.observedAt.getTime())) {
      throw new ValidationError('FIELD_OBS_TIME_INVALID', '관측 시각이 올바르지 않습니다.');
    }
    // 미래 관측은 받지 않는다. 시계 오차 정도는 넘기되(5분), 그 이상은 입력 실수다 —
    // 미래 날짜로 들어오면 그날의 대조에서 조용히 빠진다.
    if (input.observedAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new ValidationError('FIELD_OBS_TIME_FUTURE', '미래 시각의 관측은 기록할 수 없습니다.', {
        observedAt: input.observedAt.toISOString(),
      });
    }

    const density = input.densityLevel ?? null;
    if (density !== null && !isDensityLevel(density)) {
      throw new ValidationError('FIELD_OBS_DENSITY_INVALID', '허용되지 않은 밀도 값입니다.', {
        densityLevel: density,
      });
    }

    // 출현 여부와 밀도는 서로를 강제한다.
    if (input.jellyfishPresent && density === null) {
      throw new ValidationError(
        'FIELD_OBS_DENSITY_REQUIRED',
        '해파리를 봤다면 밀도(저/중/고)를 함께 기록해야 합니다.',
      );
    }
    if (!input.jellyfishPresent && density !== null) {
      throw new ValidationError(
        'FIELD_OBS_DENSITY_NOT_ALLOWED',
        '해파리가 없었다면 밀도를 기록할 수 없습니다.',
        { densityLevel: density },
      );
    }

    const count = input.estimatedCount ?? null;
    if (count !== null) {
      if (!Number.isInteger(count) || count < 0 || count > COUNT_MAX) {
        throw new ValidationError('FIELD_OBS_COUNT_RANGE', '추정 개체 수가 올바르지 않습니다.', {
          estimatedCount: count,
        });
      }
      if (!input.jellyfishPresent && count > 0) {
        throw new ValidationError(
          'FIELD_OBS_COUNT_CONFLICT',
          '해파리가 없었다면 개체 수를 기록할 수 없습니다.',
        );
      }
    }

    const note = input.note?.trim() ? input.note.trim() : null;
    if (note !== null && note.length > NOTE_MAX) {
      throw new ValidationError('FIELD_OBS_NOTE_TOO_LONG', '메모가 너무 깁니다.');
    }
    const observerName = input.observerName?.trim() ? input.observerName.trim() : null;
    if (observerName !== null && observerName.length > OBSERVER_NAME_MAX) {
      throw new ValidationError('FIELD_OBS_OBSERVER_TOO_LONG', '관측자 이름이 너무 깁니다.');
    }

    return new FieldObservation({
      beachId: input.beachId,
      observedAt: input.observedAt,
      source: input.source,
      observerId: input.observerId ?? null,
      observerName,
      jellyfishPresent: input.jellyfishPresent,
      densityLevel: density,
      speciesId: input.speciesId ?? null,
      estimatedCount: count,
      note,
      createdAt: now,
    });
  }

  /** DB 등 영속 저장소에서 복원. 불변식 검증 없이 그대로 재구성한다. */
  static reconstitute(props: FieldObservationProps): FieldObservation {
    return new FieldObservation(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id {
    return this.props.beachId;
  }
  get jellyfishPresent(): boolean {
    return this.props.jellyfishPresent;
  }
  get densityLevel(): DensityLevel | null {
    return this.props.densityLevel;
  }

  snapshot(): Readonly<FieldObservationProps> {
    return { ...this.props };
  }
}
