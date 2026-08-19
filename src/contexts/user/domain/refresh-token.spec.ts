import {
  evaluateRefreshToken,
  generateFamilyId,
  generateRefreshToken,
  hashRefreshToken,
  isRefreshTokenFormat,
  issueRefreshToken,
  refreshTokenExpiresAt,
  StoredRefreshToken,
} from './refresh-token';

const AT = new Date('2026-08-19T00:00:00.000Z');

function stored(overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return {
    id: 1,
    userId: 7,
    familyId: 'f'.repeat(32),
    issuedAt: AT,
    expiresAt: new Date(AT.getTime() + 14 * 24 * 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('리프레시 토큰 발급', () => {
  it('매번 다른 값이 나온다 — 남의 토큰을 추측할 수 없어야 한다', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(200);
  });

  it('형식은 r + base64url 43자 (총 44자)', () => {
    const token = generateRefreshToken();
    expect(token).toHaveLength(44);
    expect(isRefreshTokenFormat(token)).toBe(true);
  });

  it('우리가 만들지 않은 값은 형식에서 걸린다 — DB 를 조회할 필요조차 없다', () => {
    expect(isRefreshTokenFormat('')).toBe(false);
    expect(isRefreshTokenFormat('refresh-token')).toBe(false);
    expect(isRefreshTokenFormat('r' + 'a'.repeat(42))).toBe(false); // 한 자 짧다
    expect(isRefreshTokenFormat('r' + 'a'.repeat(44))).toBe(false); // 한 자 길다
    expect(isRefreshTokenFormat('g' + 'a'.repeat(43))).toBe(false); // 게스트 토큰 접두사
    expect(isRefreshTokenFormat('r' + 'a'.repeat(42) + '+')).toBe(false); // base64url 아님
  });

  it('family id 는 hex 32자이고 매번 다르다', () => {
    const id = generateFamilyId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(generateFamilyId()).not.toBe(id);
  });
});

describe('해시 저장', () => {
  it('같은 토큰은 항상 같은 해시 — UNIQUE 인덱스로 바로 찾을 수 있다', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('해시는 hex 64자이고 원문을 담고 있지 않다', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(1));
  });

  it('한 글자만 달라도 완전히 다른 해시가 된다', () => {
    const a = 'r' + 'a'.repeat(43);
    const b = 'r' + 'a'.repeat(42) + 'b';
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});

describe('만료 계산', () => {
  it('발급 시각 + 일수', () => {
    expect(refreshTokenExpiresAt(AT, 14).toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('issueRefreshToken 은 원문·해시·만료를 한 벌로 만든다', () => {
    const issued = issueRefreshToken(AT, 7);
    expect(issued.tokenHash).toBe(hashRefreshToken(issued.token));
    expect(issued.issuedAt).toBe(AT);
    expect(issued.expiresAt.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(issued.familyId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('회전할 때는 사슬(family)을 이어받는다 — 사고 시 사슬 전체를 끊기 위해서다', () => {
    const first = issueRefreshToken(AT, 14);
    const rotated = issueRefreshToken(AT, 14, first.familyId);
    expect(rotated.familyId).toBe(first.familyId);
    expect(rotated.token).not.toBe(first.token);
  });
});

describe('상태 판정', () => {
  it('아직 쓰지 않았고 만료 전이면 valid', () => {
    expect(evaluateRefreshToken(stored(), AT)).toBe('valid');
  });

  it('이미 쓴 토큰이 다시 오면 reused — 정상 클라이언트에서는 나올 수 없는 요청이다', () => {
    expect(evaluateRefreshToken(stored({ usedAt: AT }), AT)).toBe('reused');
  });

  it('무효화된 토큰은 revoked (로그아웃·재사용 감지의 결과)', () => {
    expect(evaluateRefreshToken(stored({ revokedAt: AT }), AT)).toBe('revoked');
  });

  it('만료 시각 이후면 expired — 경계(같은 시각)는 만료로 본다', () => {
    const expiresAt = new Date(AT.getTime() + 1000);
    expect(evaluateRefreshToken(stored({ expiresAt }), new Date(AT.getTime() + 999))).toBe('valid');
    expect(evaluateRefreshToken(stored({ expiresAt }), new Date(AT.getTime() + 1000))).toBe(
      'expired',
    );
  });

  it('재사용은 만료보다 먼저 판정한다 — 만료된 뒤에 와도 도난 신호는 그대로다', () => {
    const past = new Date(AT.getTime() - 1000);
    expect(evaluateRefreshToken(stored({ usedAt: past, expiresAt: past }), AT)).toBe('reused');
  });

  it('무효화가 재사용보다 앞선다 — 이미 내려진 결정이다', () => {
    expect(evaluateRefreshToken(stored({ usedAt: AT, revokedAt: AT }), AT)).toBe('revoked');
  });
});
