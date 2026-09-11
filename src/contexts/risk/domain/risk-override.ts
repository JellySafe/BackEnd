import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { RISK_LEVEL_LABELS, RiskLevel, isRiskLevel } from '@shared/kernel/risk-level';
import { MinLevelTrigger } from './risk-engine';

/**
 * 운영자 수동 등급 상향.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 지금까지는 룰 엔진이 낸 값이 그대로 시민에게 나갔다. 현장이 "지금 명백히 위험한데 시스템은
 * 낮음" 이라고 판단해도 **손댈 방법이 없었다.** 관측이 끊긴 해변(12곳 중 5곳이 그렇다),
 * 룰이 아직 모르는 상황(대량 표착, 현장 육안 확인)에서 그 간극이 생긴다.
 *
 * ── 올리기만 한다 ────────────────────────────────────────────────────────────────────
 * 내리는 조작은 **만들지 않았다.** 두 실수의 비용이 다르기 때문이다.
 *
 *   · 잘못 올리면 → 헛걱정으로 끝난다
 *   · 잘못 내리면 → **사람이 물에 들어간다**
 *
 * 그래서 방향을 하나만 연다. 엔진에는 이미 "최소 단계 보장"(RISK-002)이 있고 그것은 구조적으로
 * 낮추지 못하므로(`maxRiskLevel`), 이 기능은 **그 트리거를 하나 더 넣는 것**으로 끝난다.
 * 엔진을 고치지 않아도 되는 것이 이 설계가 맞다는 신호다.
 *
 * `safe` 로는 상향할 수 없다. 아무것도 올리지 못하는 값이라 동작은 무해하지만, 운영자가
 * **"안전으로 내렸다" 고 착각하게 만든다.** 할 수 없는 일을 할 수 있는 것처럼 보이게 두지 않는다.
 *
 * ── 기한이 반드시 있다 ───────────────────────────────────────────────────────────────
 * 기한 없는 상향은 **아무도 기억하지 않는 영구 상태**가 된다. 한 달 뒤에도 '위험' 인 해변을
 * 보고 아무도 이유를 모르는 것이 이 기능의 가장 흔한 실패다. 그래서 만료가 필수이고 상한도 있다.
 * 계속 필요하면 다시 올리면 된다 — **다시 판단하게 만드는 것이 목적이다.**
 */

/** 상향 최대 기간. 이보다 길게 두려면 기간이 끝날 때 다시 판단해야 한다. */
export const MAX_OVERRIDE_HOURS = 72;

/** 사유 최대 길이. DB 컬럼(VARCHAR(300))과 맞춘다. */
export const MAX_REASON_LENGTH = 300;

/** 엔진에 넘길 때 쓰는 룰 코드. 사람이 올린 것임을 화면·로그에서 구분하는 표식이다. */
export const MANUAL_OVERRIDE_RULE_CODE = 'MANUAL_OVERRIDE';

/**
 * 시작 시각을 **초 단위로 내린다.**
 *
 * ── 왜 필요한가 (실 DB 에서 잡힌 결함) ───────────────────────────────────────────────
 * `starts_at` 은 MySQL `DATETIME(0)` 이고, MySQL 은 소수점 이하를 **반올림한다** —
 * `12:34:56.789` 를 넣으면 `12:34:57` 로 저장된다(실측 확인).
 *
 * 그러면 방금 만든 상향의 시작 시각이 **미래**가 된다. 저장 직후 곧바로 도는 재산출은
 * `starts_at <= now` 를 만족하지 못해 그 상향을 **못 보고 지나간다.** 0.5초 차이로
 * 절반 정도가 조용히 실패하는, 재현이 어려운 종류의 결함이다.
 *
 * 내림으로 고정하면 저장값이 실제 생성 시각보다 **늦어질 수 없다.**
 */
function floorToSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

export interface RiskOverrideProps {
  id?: Id;
  beachId: Id;
  minRiskLevel: RiskLevel;
  reason: string;
  createdBy: Id | null;
  startsAt: Date;
  expiresAt: Date;
  releasedAt: Date | null;
  releasedBy: Id | null;
}

export class RiskOverride {
  private constructor(private props: RiskOverrideProps) {}

  /**
   * 새 상향을 만든다. 여기서 막는 것이 이 기능의 안전장치 전부다.
   *
   * @param durationHours 유효 기간(시간). 1 이상 MAX_OVERRIDE_HOURS 이하.
   */
  static create(params: {
    beachId: Id;
    minRiskLevel: string;
    reason: string;
    createdBy: Id | null;
    durationHours: number;
    now: Date;
  }): RiskOverride {
    if (!params.beachId || params.beachId <= 0) {
      throw new ValidationError('OVERRIDE_BEACH_REQUIRED', '해변 식별자가 필요합니다.');
    }

    if (!isRiskLevel(params.minRiskLevel)) {
      throw new ValidationError(
        'OVERRIDE_LEVEL_INVALID',
        `알 수 없는 위험 단계입니다: ${params.minRiskLevel}`,
      );
    }
    if (params.minRiskLevel === 'safe') {
      // 동작만 보면 무해하다(아무것도 올리지 못한다). 막는 이유는 **오해** 때문이다 —
      // 운영자는 이걸 "안전으로 내렸다" 로 읽는다. 이 기능에 내리는 방향은 없다.
      throw new ValidationError(
        'OVERRIDE_LEVEL_NOT_RAISING',
        "'낮음' 으로는 상향할 수 없습니다. 이 기능은 단계를 **올리기만** 합니다 — 내리는 조작은 제공하지 않습니다.",
      );
    }

    const reason = params.reason.trim();
    if (reason.length === 0) {
      // 사유가 없으면 **나중에 해제 판단을 할 수 없다.** 왜 올렸는지 모르는 상향은
      // 만료될 때까지 아무도 건드리지 못한다.
      throw new ValidationError(
        'OVERRIDE_REASON_REQUIRED',
        '상향 사유를 입력해 주세요. 사유가 없으면 나중에 해제할지 판단할 수 없습니다.',
      );
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new ValidationError(
        'OVERRIDE_REASON_TOO_LONG',
        `상향 사유는 ${MAX_REASON_LENGTH}자를 넘을 수 없습니다.`,
      );
    }

    if (!Number.isFinite(params.durationHours) || params.durationHours <= 0) {
      throw new ValidationError('OVERRIDE_DURATION_INVALID', '유효 기간은 1시간 이상이어야 합니다.');
    }
    if (params.durationHours > MAX_OVERRIDE_HOURS) {
      throw new ValidationError(
        'OVERRIDE_DURATION_TOO_LONG',
        `유효 기간은 최대 ${MAX_OVERRIDE_HOURS}시간입니다. 더 필요하면 기간이 끝날 때 다시 올려 주세요 — 상향을 계속 둘지 다시 판단하게 하려는 제한입니다.`,
      );
    }

    // 초 단위로 내려서 시작한다(floorToSecond 주석 — DB 반올림 때문에 미래가 되면
    // 저장 직후의 재산출이 이 상향을 못 본다). 만료도 같은 기준에서 계산해 기간이 어긋나지 않게 한다.
    const startsAt = floorToSecond(params.now);

    return new RiskOverride({
      beachId: params.beachId,
      minRiskLevel: params.minRiskLevel,
      reason,
      createdBy: params.createdBy,
      startsAt,
      expiresAt: new Date(startsAt.getTime() + params.durationHours * 3_600_000),
      releasedAt: null,
      releasedBy: null,
    });
  }

  /** DB row 복원. 불변식 검증 없이 재구성한다(이미 통과한 값이다). */
  static reconstitute(props: RiskOverrideProps): RiskOverride {
    return new RiskOverride(props);
  }

  /**
   * 만료 전에 손으로 내린다.
   *
   * 이미 해제됐으면 **아무 일도 하지 않는다.** 두 사람이 동시에 해제를 누르는 상황에서
   * 뒤에 누른 쪽이 오류를 보는 것은 의미가 없다 — 원하는 상태(해제됨)는 이미 이뤄졌다.
   */
  release(by: Id | null, now: Date): void {
    if (this.props.releasedAt !== null) return;
    // 시작 시각과 같은 이유로 초 단위로 내린다(DB 가 반올림해 미래가 되지 않게).
    this.props.releasedAt = floorToSecond(now);
    this.props.releasedBy = by;
  }

  /**
   * 그 시각에 유효한가.
   *
   * `now` 만이 아니라 **미래 시각으로도 묻는다.** 24h·72h 예보에 이 상향을 적용할지
   * 판단해야 하기 때문이다 — 6시간 뒤 만료되는 상향을 72시간 예보에 얹으면 거짓이 된다.
   */
  isActiveAt(at: Date): boolean {
    if (this.props.releasedAt !== null && at.getTime() >= this.props.releasedAt.getTime()) {
      return false;
    }
    return at.getTime() >= this.props.startsAt.getTime() && at.getTime() < this.props.expiresAt.getTime();
  }

  /**
   * 엔진에 넘길 최소 단계 트리거.
   *
   * ⚠️ 이 값은 **다른 트리거와 달리 시간이 지나도 약해지지 않는다**(decayMinLevelTriggers 의
   *    대상이 아니다). 근거가 흐려지는 관측과 달리, 사람이 "여기는 위험하다" 고 정한 판단은
   *    기간 안에서는 그대로다. 대신 기간 밖에서는 아예 적용되지 않는다(isActiveAt).
   */
  toMinLevelTrigger(): MinLevelTrigger {
    return { ruleCode: MANUAL_OVERRIDE_RULE_CODE, level: this.props.minRiskLevel };
  }

  /** 로그·감사에 남길 한 줄 요약. */
  describe(): string {
    return `${RISK_LEVEL_LABELS[this.props.minRiskLevel]} 이상 보장 (~${this.props.expiresAt.toISOString()})`;
  }

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id {
    return this.props.beachId;
  }
  get minRiskLevel(): RiskLevel {
    return this.props.minRiskLevel;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }
  get releasedAt(): Date | null {
    return this.props.releasedAt;
  }

  snapshot(): Readonly<RiskOverrideProps> {
    return { ...this.props };
  }
}
