import { GUEST_TOKEN_LENGTH, issueGuestToken, verifyGuestToken } from './guest-token';

/**
 * 게스트 토큰의 보안 성질을 고정한다.
 *
 * 이 토큰 하나가 비로그인 사용자의 신원 전부다 — 관심 해변, 알림함, 푸시 구독이 여기 묶인다.
 * 그래서 검증할 것은 "형식이 맞는가"가 아니라 **"남의 것이 될 수 있는가"** 다.
 */
describe('게스트 토큰', () => {
  const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

  describe('발급', () => {
    it('고정 길이(46자)의 g<id>.<sig> 형식이다', () => {
      const token = issueGuestToken(SECRET);

      expect(token).toHaveLength(GUEST_TOKEN_LENGTH);
      expect(token).toMatch(/^g[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    });

    it('DB 컬럼(VARCHAR 64)과 DTO maxLength(64) 안에 들어간다', () => {
      expect(GUEST_TOKEN_LENGTH).toBeLessThanOrEqual(64);
    });

    it('매번 다른 값이 나온다 — 두 사용자가 같은 토큰을 받으면 자료가 섞인다', () => {
      const tokens = new Set(Array.from({ length: 200 }, () => issueGuestToken(SECRET)));
      expect(tokens.size).toBe(200);
    });
  });

  describe('검증', () => {
    it('스스로 발급한 토큰을 통과시킨다', () => {
      expect(verifyGuestToken(issueGuestToken(SECRET), SECRET)).toBe(true);
    });

    it('클라이언트가 지어낸 문자열을 거부한다 — 예전 방식이 뚫려 있던 지점', () => {
      for (const fake of ['guest-1', 'guest-9f2c1a7b4e', 'test', 'a', '', 'g'.repeat(46)]) {
        expect(verifyGuestToken(fake, SECRET)).toBe(false);
      }
    });

    it('서명이 맞지 않으면 거부한다 (id 변조)', () => {
      const token = issueGuestToken(SECRET);
      const flipped = token[1] === 'A' ? 'B' : 'A';
      expect(verifyGuestToken(`g${flipped}${token.slice(2)}`, SECRET)).toBe(false);
    });

    it('서명이 맞지 않으면 거부한다 (sig 변조)', () => {
      const token = issueGuestToken(SECRET);
      const sep = token.indexOf('.');
      const sig = token.slice(sep + 1);
      const flipped = sig[0] === 'A' ? 'B' : 'A';
      expect(verifyGuestToken(`${token.slice(0, sep + 1)}${flipped}${sig.slice(1)}`, SECRET)).toBe(
        false,
      );
    });

    it('다른 비밀키로 발급된 토큰은 통과하지 못한다', () => {
      const foreign = issueGuestToken('another-secret-0123456789abcdef0123456789');
      expect(verifyGuestToken(foreign, SECRET)).toBe(false);
    });

    it('올바른 id 에 다른 토큰의 서명을 붙여 넣을 수 없다', () => {
      const a = issueGuestToken(SECRET);
      const b = issueGuestToken(SECRET);
      const mixed = `${a.slice(0, a.indexOf('.') + 1)}${b.slice(b.indexOf('.') + 1)}`;
      expect(verifyGuestToken(mixed, SECRET)).toBe(false);
    });

    it('형식이 어긋나면 서명 계산까지 가지 않고 거부한다', () => {
      const token = issueGuestToken(SECRET);
      expect(verifyGuestToken(token.slice(1), SECRET)).toBe(false); // 접두사 없음
      expect(verifyGuestToken(token.replace('.', ''), SECRET)).toBe(false); // 구분자 없음
      expect(verifyGuestToken(`${token}x`, SECRET)).toBe(false); // 길이 초과
      expect(verifyGuestToken(`${token} `, SECRET)).toBe(false); // 후행 공백
    });
  });
});
