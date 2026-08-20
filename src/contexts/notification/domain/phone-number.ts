import { ValidationError } from '@shared/kernel/domain-error';

/**
 * 휴대폰 번호 — 정규화·검증·마스킹 (순수 함수).
 *
 * ── 왜 정규화가 필요한가 ─────────────────────────────────────────────────────────────
 * 사용자는 `010-1234-5678`, `01012345678`, `+82 10 1234 5678` 을 모두 같은 번호로 생각한다.
 * 저장 형태를 통일하지 않으면 **같은 사람이 세 번 동의한 것처럼 보이고**, 해제할 때는 하나만
 * 지워진다(나머지 두 행으로 알림이 계속 간다). 저장은 항상 `01012345678` 형태로 한다.
 *
 * ── 왜 마스킹이 필요한가 ─────────────────────────────────────────────────────────────
 * 수신 동의 조회 응답과 발송 이력(notification_dispatches.recipient)에 번호 원문을 그대로 두면,
 * 그 화면이나 로그를 보는 사람 모두가 개인정보를 보게 된다. 확인에 필요한 것은 "내가 등록한
 * 그 번호가 맞나" 뿐이므로 가운데를 가린다.
 */

/** 저장 형태: 숫자만, 010으로 시작하는 11자리. */
const NORMALIZED = /^010\d{8}$/;

/**
 * 입력을 저장 형태로 정규화한다. 휴대폰 번호가 아니면 예외.
 *
 * 국내 휴대폰(010)만 받는다. 안전 알림은 즉시성이 중요한데 국제 발신은 지연·차단이 잦고,
 * 이 서비스의 대상은 제주 해수욕장 이용자다. 011/016 등 구 번호는 2004년에 신규 가입이
 * 끝났고 2021년 2G 종료로 사라졌다.
 */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '').replace(/^\+82/, '0');
  if (!NORMALIZED.test(digits)) {
    throw new ValidationError(
      'PHONE_NUMBER_INVALID',
      '휴대폰 번호 형식이 올바르지 않습니다(예: 010-1234-5678).',
    );
  }
  return digits;
}

/** 저장 형태인지 확인(이미 정규화된 값에만 쓴다). */
export function isNormalizedPhoneNumber(value: string): boolean {
  return NORMALIZED.test(value);
}

/**
 * 표시·기록용 마스킹: `010-1234-5678` → `010-****-5678`.
 * 뒤 4자리를 남기는 이유는 사용자가 자기 번호를 알아볼 수 있어야 하기 때문이다.
 */
export function maskPhoneNumber(normalized: string): string {
  if (!NORMALIZED.test(normalized)) return '***';
  return `${normalized.slice(0, 3)}-****-${normalized.slice(7)}`;
}
