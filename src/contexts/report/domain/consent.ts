import { ValidationError } from '@shared/kernel/domain-error';
import { CONSENT_TYPES, ConsentType } from './report-enums';

/**
 * 개인정보 동의 기록 (PRIV-001~003) — 순수 규칙.
 *
 * ── 왜 동의를 따로 기록하나 ──────────────────────────────────────────────────────────
 * 제보에는 사진과 위치가 들어간다. 둘 다 개인정보라 **받아도 된다는 근거**가 있어야 하고,
 * 그 근거는 "동의를 받았다"가 아니라 "누가, 언제, 어떤 버전의 고지에, 무엇에 동의했다"는
 * 기록이어야 한다. 나중에 분쟁이 생기면 그 기록이 유일한 증거다.
 *
 * ── 필수 동의 ────────────────────────────────────────────────────────────────────────
 * 제보에는 privacy(개인정보)·location(위치)·image(사진) 셋이 모두 필요하다. marketing 은
 * 제보와 무관한 선택 동의라 필수 목록에 없다. **거부(agreed=false)도 기록한다** — 거부한 사실
 * 자체가 "동의 없이 수집하지 않았다"의 증거이고, 기록을 남기지 않으면 물어본 적조차 증명할 수 없다.
 *
 * ── 보관 ─────────────────────────────────────────────────────────────────────────────
 * 동의 기록의 만료(expires_at)는 제보 사진·위치의 파기 시점보다 **길다.** 제보 데이터는 목적을
 * 다하면 지워야 하지만(최소 수집), 동의 기록은 그 처리가 적법했음을 사후에 증명하는 자료라
 * 조금 더 남겨야 한다. 다만 무한 보관은 그 자체가 또 다른 개인정보 보관이므로 기한을 둔다.
 */

/** 제보에 반드시 필요한 동의 항목. 하나라도 빠지면 제보를 받지 않는다. */
export const REQUIRED_CONSENT_TYPES: readonly ConsentType[] = ['privacy', 'location', 'image'];

/** 동의 한 건. */
export interface ConsentDecision {
  type: ConsentType;
  agreed: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 동의 기록 만료 시각. 동의 시점 + 보관 일수. */
export function consentExpiresAt(agreedAt: Date, retentionDays: number): Date {
  return new Date(agreedAt.getTime() + retentionDays * MS_PER_DAY);
}

/**
 * 제보에 필요한 동의가 모두 갖춰졌는지 확인한다.
 * 빠졌거나 거부된 항목이 있으면 무엇이 문제인지 알려준다(클라이언트가 그 화면으로 되돌려야 한다).
 */
export function assertReportConsents(decisions: readonly ConsentDecision[]): void {
  const byType = new Map(decisions.map((d) => [d.type, d.agreed]));

  const missing = REQUIRED_CONSENT_TYPES.filter((t) => !byType.has(t));
  if (missing.length > 0) {
    throw new ValidationError('CONSENT_REQUIRED_MISSING', '제보에 필요한 동의 항목이 빠졌습니다.', {
      missing,
      required: REQUIRED_CONSENT_TYPES,
    });
  }

  const refused = REQUIRED_CONSENT_TYPES.filter((t) => byType.get(t) === false);
  if (refused.length > 0) {
    throw new ValidationError(
      'CONSENT_REQUIRED_REFUSED',
      '동의하지 않은 항목이 있어 제보를 접수할 수 없습니다.',
      { refused },
    );
  }
}

/** 중복 항목(같은 type 두 번)을 걸러낸다. 같은 요청에 두 번 오면 마지막 값을 쓴다. */
export function normalizeConsents(decisions: readonly ConsentDecision[]): ConsentDecision[] {
  const byType = new Map<ConsentType, boolean>();
  for (const d of decisions) {
    if (!(CONSENT_TYPES as readonly string[]).includes(d.type)) {
      throw new ValidationError('CONSENT_TYPE_UNKNOWN', '알 수 없는 동의 항목입니다.', {
        type: d.type,
        allowed: CONSENT_TYPES,
      });
    }
    byType.set(d.type, d.agreed);
  }
  return [...byType].map(([type, agreed]) => ({ type, agreed }));
}
