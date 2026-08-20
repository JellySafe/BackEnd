import {
  currentRequestId,
  newRequestId,
  runWithRequestContext,
  sanitizeRequestId,
} from './request-context';

/**
 * 상관관계 ID 는 **로그에 그대로 찍히는 클라이언트 입력**이다. 거르지 않으면
 * 개행 한 줄로 가짜 로그를 만들어 낼 수 있다(로그 위조).
 */
describe('요청 상관관계 ID', () => {
  describe('클라이언트가 보낸 값 받아들이기', () => {
    it.each([
      'abc123',
      '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      'trace_id-42',
      'A'.repeat(128),
    ])('얌전한 값 %p 는 그대로 이어받는다 — 앞단 로그와 사슬이 이어져야 한다', (value) => {
      expect(sanitizeRequestId(value)).toBe(value);
    });

    it('앞뒤 공백은 정리한다', () => {
      expect(sanitizeRequestId('  abc  ')).toBe('abc');
    });

    it('개행이 든 값은 버린다 — 로그에 가짜 줄을 심는 수단이 된다', () => {
      expect(sanitizeRequestId('abc\n2026-01-01 ERROR 관리자 로그인 성공')).toBeNull();
    });

    it.each([
      ['공백 포함', 'abc def'],
      ['따옴표', "abc'def"],
      ['꺾쇠', '<script>'],
      ['퍼센트', 'a%00b'],
      ['빈 문자열', ''],
      ['공백만', '   '],
    ])('%s 은 버린다', (_label, value) => {
      expect(sanitizeRequestId(value)).toBeNull();
    });

    it('128자를 넘으면 버린다 — 길이 제한이 없으면 로그를 부풀리는 수단이 된다', () => {
      expect(sanitizeRequestId('A'.repeat(129))).toBeNull();
    });

    it.each([undefined, null, 42, {}, ['a']])('문자열이 아닌 %p 는 버린다', (value) => {
      expect(sanitizeRequestId(value)).toBeNull();
    });
  });

  describe('새 ID', () => {
    it('생성한 값은 스스로의 검사를 통과한다', () => {
      const id = newRequestId();
      expect(sanitizeRequestId(id)).toBe(id);
    });

    it('매번 다른 값이다', () => {
      const ids = new Set(Array.from({ length: 100 }, () => newRequestId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('컨텍스트 전파', () => {
    it('요청 밖에서는 null 이다 — 배치·부팅에서 일어난 일임을 구분할 수 있어야 한다', () => {
      expect(currentRequestId()).toBeNull();
    });

    it('컨텍스트 안에서는 그 값을 본다', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        expect(currentRequestId()).toBe('req-1');
      });
    });

    it('await 를 건너서도 이어진다 — 서비스·리포지토리까지 인자 없이 따라가야 의미가 있다', async () => {
      await runWithRequestContext({ requestId: 'req-async' }, async () => {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 1));
        expect(currentRequestId()).toBe('req-async');
      });
    });

    it('동시에 도는 두 요청이 서로의 값을 보지 않는다', async () => {
      const seen: string[] = [];

      const one = runWithRequestContext({ requestId: 'req-A' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(currentRequestId() ?? 'none');
      });
      const two = runWithRequestContext({ requestId: 'req-B' }, async () => {
        seen.push(currentRequestId() ?? 'none');
      });

      await Promise.all([one, two]);
      expect(seen.sort()).toEqual(['req-A', 'req-B']);
    });

    it('컨텍스트를 빠져나오면 다시 null 이다', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => undefined);
      expect(currentRequestId()).toBeNull();
    });
  });
});
