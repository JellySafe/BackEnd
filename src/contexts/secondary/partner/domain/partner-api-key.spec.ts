import {
  apiKeyMatches,
  apiKeyPrefixOf,
  evaluateApiKey,
  hasScope,
  hashApiKey,
  isApiKeyFormat,
  issueApiKey,
  normalizeScopes,
  StoredApiKey,
} from './partner-api-key';

const NOW = new Date('2026-08-20T00:00:00.000Z');

function stored(overrides: Partial<StoredApiKey> = {}): StoredApiKey {
  return {
    apiKeyId: 1,
    partnerId: 7,
    keyPrefix: 'jsp_0123456789ab',
    apiKeyHash: hashApiKey('x'),
    scopes: ['risk:read'],
    rateLimitPerMin: 60,
    expiresAt: null,
    revokedAt: null,
    partnerStatus: 'active',
    ...overrides,
  };
}

describe('API 키 발급', () => {
  it('형식은 jsp_<12자>_<43자> 이고 매번 다르다', () => {
    const a = issueApiKey();
    const b = issueApiKey();

    expect(isApiKeyFormat(a.apiKey)).toBe(true);
    expect(a.apiKey).not.toBe(b.apiKey);
    expect(a.keyPrefix).toHaveLength(16); // key_prefix VARCHAR(16) 에 맞는다
  });

  it('접두사는 키 안에 그대로 들어 있다 — 조회 키가 된다', () => {
    const issued = issueApiKey();
    expect(issued.apiKey.startsWith(`${issued.keyPrefix}_`)).toBe(true);
    expect(apiKeyPrefixOf(issued.apiKey)).toBe(issued.keyPrefix);
  });

  it('저장값은 해시뿐이다 — 원문이 들어 있지 않다', () => {
    const issued = issueApiKey();
    const secret = issued.apiKey.split('_')[2];

    expect(issued.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.apiKeyHash).not.toContain(secret);
  });

  it('우리가 만들지 않은 값은 형식에서 걸린다', () => {
    expect(isApiKeyFormat('')).toBe(false);
    expect(isApiKeyFormat('jsp_short_abc')).toBe(false);
    expect(isApiKeyFormat('api-key-12345')).toBe(false);
    expect(apiKeyPrefixOf('not-a-key')).toBeNull();
  });
});

describe('키 비교', () => {
  it('같은 키는 통과하고 한 글자만 달라도 막힌다', () => {
    const issued = issueApiKey();

    expect(apiKeyMatches(issued.apiKey, issued.apiKeyHash)).toBe(true);
    expect(apiKeyMatches(`${issued.apiKey}x`, issued.apiKeyHash)).toBe(false);
  });

  it('저장 해시 길이가 이상해도 예외를 던지지 않는다 (깨진 데이터 방어)', () => {
    expect(apiKeyMatches(issueApiKey().apiKey, 'broken')).toBe(false);
  });
});

describe('키 상태', () => {
  it('살아 있는 키는 valid', () => {
    expect(evaluateApiKey(stored(), NOW)).toBe('valid');
  });

  it('폐기된 키는 revoked (가장 먼저 본다 — 이미 내려진 결정이다)', () => {
    expect(evaluateApiKey(stored({ revokedAt: NOW, expiresAt: NOW }), NOW)).toBe('revoked');
  });

  it('만료 시각이 지나면 expired — 경계(같은 시각)는 만료로 본다', () => {
    expect(evaluateApiKey(stored({ expiresAt: new Date(NOW.getTime() + 1) }), NOW)).toBe('valid');
    expect(evaluateApiKey(stored({ expiresAt: NOW }), NOW)).toBe('expired');
  });

  it('계약이 끝난 제휴사는 키가 살아 있어도 막는다', () => {
    expect(evaluateApiKey(stored({ partnerStatus: 'suspended' }), NOW)).toBe('partner_inactive');
    expect(evaluateApiKey(stored({ partnerStatus: 'terminated' }), NOW)).toBe('partner_inactive');
  });
});

describe('스코프', () => {
  it('가진 범위만 통과한다', () => {
    const key = stored({ scopes: ['risk:read'] });
    expect(hasScope(key, 'risk:read')).toBe(true);
    expect(hasScope(key, 'beach:read')).toBe(false);
  });

  it('저장된 값을 그대로 믿지 않는다 — 모르는 범위·중복·비배열을 정리한다', () => {
    expect(normalizeScopes(['risk:read', 'risk:read', 'admin:*', 1])).toEqual(['risk:read']);
    expect(normalizeScopes(null)).toEqual([]);
    expect(normalizeScopes('risk:read')).toEqual([]);
  });
});
