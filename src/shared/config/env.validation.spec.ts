// class-validator/class-transformer 의 데코레이터 메타데이터를 읽으려면 필요하다
// (운영에서는 main.ts 가 최상단에서 한 번 import 한다).
import 'reflect-metadata';
import { RISK_RULE_VERSIONS, validateEnv } from './env.validation';

/**
 * 환경 변수 검증 = **기동 시점의 마지막 방어선**.
 *
 * 여기서 막지 못한 잘못된 설정은 전부 런타임의 조용한 오작동이 된다.
 * 특히 RISK_RULE_VERSION 오타는 "동작하는 것처럼 보이지만 다른 점수표로 위험 단계를 매기는"
 * 상태를 만든다 — 안전 서비스에서 가장 나쁜 실패 형태다.
 */
describe('환경 변수 검증', () => {
  /** 검증을 통과하는 최소 구성. 각 테스트가 여기서 한 가지만 바꾼다. */
  const valid = {
    DATABASE_URL: 'mysql://user:pw@localhost:3306/jellysafe',
    JWT_SECRET: 'a'.repeat(32),
  };

  it('최소 구성이면 통과한다', () => {
    expect(() => validateEnv({ ...valid })).not.toThrow();
  });

  describe('DATABASE_URL', () => {
    it('없으면 기동하지 않는다', () => {
      expect(() => validateEnv({ JWT_SECRET: valid.JWT_SECRET })).toThrow(/DATABASE_URL/);
    });
  });

  describe('JWT_SECRET', () => {
    it('없으면 기동하지 않는다', () => {
      expect(() => validateEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/JWT_SECRET/);
    });

    it('32자 미만이면 기동하지 않는다 — 이 키는 관리자 토큰과 게스트 토큰을 함께 서명한다', () => {
      expect(() =>
        validateEnv({ ...valid, JWT_SECRET: 'jellysafe-dev-secret-change-me' }),
      ).toThrow(/32자/);
    });

    it('32자 이상이면 통과한다', () => {
      expect(() => validateEnv({ ...valid, JWT_SECRET: 'x'.repeat(32) })).not.toThrow();
    });
  });

  describe('RISK_RULE_VERSION', () => {
    it.each([...RISK_RULE_VERSIONS])('배포된 버전 %s 는 통과한다', (version) => {
      expect(() => validateEnv({ ...valid, RISK_RULE_VERSION: version })).not.toThrow();
    });

    it.each(['V3', 'v33', 'v4', 'latest', ''])(
      '오타/미배포 버전 %p 는 기동을 막는다 — 조용한 v1 롤백 방지',
      (version) => {
        expect(() => validateEnv({ ...valid, RISK_RULE_VERSION: version })).toThrow(
          /RISK_RULE_VERSION/,
        );
      },
    );

    it('미지정은 허용한다 (AppConfig 기본값으로 떨어진다)', () => {
      expect(() => validateEnv({ ...valid })).not.toThrow();
    });
  });

  describe('MOCK_COLLECTOR_FALLBACK', () => {
    it.each(['true', 'false'])('%s 는 통과한다', (value) => {
      expect(() => validateEnv({ ...valid, MOCK_COLLECTOR_FALLBACK: value })).not.toThrow();
    });

    it('오타는 기동을 막는다 — 조용히 반대로 해석되면 가짜 관측치가 운영에 들어간다', () => {
      expect(() => validateEnv({ ...valid, MOCK_COLLECTOR_FALLBACK: 'yes' })).toThrow(
        /MOCK_COLLECTOR_FALLBACK/,
      );
    });
  });

  describe('NODE_ENV', () => {
    it.each(['development', 'test', 'production'])('%s 는 통과한다', (env) => {
      expect(() => validateEnv({ ...valid, NODE_ENV: env })).not.toThrow();
    });

    it('알 수 없는 값은 기동을 막는다 — production 오타는 mock 폴백 게이트를 뒤집는다', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
    });
  });

  it('검증에 통과하면 입력을 그대로 돌려준다(값을 변형하지 않는다)', () => {
    const input = { ...valid, API_PREFIX: 'api' };
    expect(validateEnv({ ...input })).toEqual(input);
  });
});
