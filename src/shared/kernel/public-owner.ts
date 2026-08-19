import { Id } from './id';

/**
 * 공개 API 리소스(관심 해변·알림함·푸시 구독)의 소유자 — **순수 값 계약**.
 *
 * 로그인 사용자는 `userId`, 비로그인은 `userToken` 으로 식별하며 둘 중 정확히 하나만 채워진다.
 * DB 의 `(user_id, user_token)` 쌍과 1:1 대응한다.
 *
 * 이 타입이 kernel 에 있는 이유: application/도메인 계층이 소유자를 인자로 받아야 하는데,
 * 그 계층은 HTTP/인증 인프라를 몰라야 한다. **누구인지를 표현하는 값**(여기)과
 * **요청에서 그 값을 확정하는 절차**(shared/auth/public-owner.ts)를 분리한다.
 */
export interface PublicOwner {
  userId: Id | null;
  userToken: string | null;
}
