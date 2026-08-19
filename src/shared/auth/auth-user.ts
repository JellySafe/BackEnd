/**
 * 인증된 요청 주체. JwtAuthGuard 가 JWT 를 검증해 req.user 에 채운다.
 */
export interface AuthUser {
  userId: number;
  role: string; // operator | admin (public 은 익명)
  email: string;
}

/** JWT payload 형태 */
export interface JwtPayload {
  sub: number; // userId
  role: string;
  email: string;
}
