import {
  DEFAULT_JWT_EXPIRES,
  MAX_ACCESS_TOKEN_SECONDS,
  isValidDuration,
  parseDurationSeconds,
} from './duration';

/**
 * 기간 파서는 **토큰 수명을 결정한다.** 여기서 잘못 읽으면 그 결과가 곧
 * "발급 즉시 만료되는 토큰"(로그인 불가) 또는 "필요 이상으로 오래 사는 토큰"(유출 노출)이다.
 */
describe('기간 문자열 파서', () => {
  describe('정상 파싱', () => {
    it.each([
      ['30s', 30],
      ['30m', 1_800],
      ['2h', 7_200],
      ['12h', 43_200],
      ['1d', 86_400],
      ['14d', 1_209_600],
    ])('%s → %i초', (input, expected) => {
      expect(parseDurationSeconds(input)).toBe(expected);
    });

    it('공백과 대문자를 허용한다 (환경변수는 손으로 적는 값이다)', () => {
      expect(parseDurationSeconds('  2H  ')).toBe(7_200);
    });
  });

  describe('거부', () => {
    it('단위가 없으면 거부한다 — ms 라이브러리가 밀리초로 읽어 즉시 만료되는 토큰이 된다', () => {
      expect(parseDurationSeconds('30')).toBeNull();
    });

    it.each(['30min', '2 h', 'h2', '', 'abc', '30x', '-5m', '1.5h'])(
      '%p 는 거부한다',
      (input) => {
        expect(parseDurationSeconds(input)).toBeNull();
      },
    );

    it('0 은 거부한다 — 발급 즉시 만료라 로그인이 통째로 막히고, 증상은 인증 실패로 오인된다', () => {
      expect(parseDurationSeconds('0m')).toBeNull();
    });
  });

  it('isValidDuration 은 파싱 성공 여부와 같다', () => {
    expect(isValidDuration('30m')).toBe(true);
    expect(isValidDuration('30')).toBe(false);
  });

  describe('기본값과 상한', () => {
    it('기본 액세스 토큰 수명은 파싱 가능하고 운영 상한 안에 있다', () => {
      const seconds = parseDurationSeconds(DEFAULT_JWT_EXPIRES);
      expect(seconds).not.toBeNull();
      expect(seconds as number).toBeLessThanOrEqual(MAX_ACCESS_TOKEN_SECONDS);
    });

    it('예전 기본값 12h 는 이제 운영 상한을 넘는다 (의도된 변경)', () => {
      expect(parseDurationSeconds('12h') as number).toBeGreaterThan(MAX_ACCESS_TOKEN_SECONDS);
    });
  });
});
