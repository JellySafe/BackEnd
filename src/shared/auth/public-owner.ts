import { DomainError, ValidationError } from '@shared/kernel/domain-error';
import { PublicOwner } from '@shared/kernel/public-owner';
import { AuthUser } from './auth-user';
import { GuestTokenService } from './guest-token.service';

// 소유자 값 계약 자체는 kernel 에 있다(application 계층이 인증 인프라를 import 하지 않도록).
// 여기는 "요청에서 그 값을 확정하는 절차"만 담당한다.
export { PublicOwner };

/**
 * 공개 API 요청의 소유자를 확정한다. **신원은 요청 본문이 아니라 자격증명에서만 온다.**
 *
 * ── 규칙 ─────────────────────────────────────────────────────────────────────────────
 *  1) `Authorization: Bearer <JWT>` 가 있으면 그 토큰의 주체(sub)가 소유자다.
 *     → body/query 의 userId 나 x-user-id 헤더는 **읽지 않는다.** 애초에 DTO 에서 제거했다.
 *  2) 없으면 게스트 토큰으로 식별한다. 단 **서버가 발급한 토큰만** 인정한다(HMAC 검증).
 *  3) 둘 다 없으면 400. 게스트 토큰이 위조/형식 오류면 401.
 *
 * ── 왜 이래야 하나 ───────────────────────────────────────────────────────────────────
 * 예전에는 `?userId=1` 이나 `x-user-id: 1` 만으로 남의 알림함·관심 해변을 읽고 지울 수 있었다
 * (users.id 는 순차 BIGINT 라 전수 열거가 가능하다). 관심 해변은 위험 알림 발송 대상이므로
 * 이건 개인정보 문제를 넘어 **타인의 안전 알림을 끌 수 있는** 결함이었다.
 *
 * 로그인 여부와 무관하게 이 함수 하나만 거치게 해서, 새 공개 엔드포인트가 추가돼도
 * 같은 규칙이 자동으로 적용되게 한다.
 */
export function resolvePublicOwner(
  user: AuthUser | undefined,
  rawToken: string | undefined,
  guestTokens: GuestTokenService,
): PublicOwner {
  // 1) 로그인 사용자: JWT 주체가 곧 소유자다.
  if (user) {
    return { userId: user.userId, userToken: null };
  }

  // 2) 비로그인: 서버가 발급한 게스트 토큰만 인정한다.
  const token = rawToken?.trim() ?? '';
  if (token.length === 0) {
    throw new ValidationError(
      'OWNER_REQUIRED',
      '사용자 식별이 필요합니다. 로그인(Authorization: Bearer) 하거나 게스트 토큰(POST /public/guest-tokens)을 발급받아 보내세요.',
    );
  }
  if (!guestTokens.verify(token)) {
    // 위조/구형 토큰은 '잘못된 입력'이 아니라 '유효하지 않은 자격증명'이다 → 401.
    throw new DomainError(
      'UNAUTHORIZED',
      'GUEST_TOKEN_INVALID',
      '유효하지 않은 게스트 토큰입니다. POST /public/guest-tokens 로 새로 발급받으세요.',
    );
  }

  return { userId: null, userToken: token };
}
