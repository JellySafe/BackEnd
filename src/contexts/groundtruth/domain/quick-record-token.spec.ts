import { parseKstDateKey } from '@shared/kernel/kst-date';
import { issueQuickRecordToken, verifyQuickRecordToken } from './quick-record-token';

/**
 * 현장 기록 간편 링크 토큰.
 *
 * 이 토큰은 **로그인 없이 데이터를 쓰게 해 준다.** 그래서 여기서 지키는 것은 편의가 아니라
 * **권한이 좁게 잘려 있는지**다 — 해변 하나, 날짜 하루, 그 이상은 안 된다.
 */
describe('현장 기록 간편 토큰', () => {
  const SECRET = 'quick-record-secret-that-is-long-enough-32';
  const DATE = parseKstDateKey('2026-09-13');

  it('발급한 토큰은 검증을 통과하고 범위를 그대로 돌려준다', () => {
    const token = issueQuickRecordToken(7, DATE, SECRET);

    expect(verifyQuickRecordToken(token, SECRET)).toEqual({ beachId: 7, dateKey: '2026-09-13' });
  });

  it('토큰에 해변과 날짜가 보인다 — 링크만 봐도 무엇에 쓰는지 알 수 있다', () => {
    expect(issueQuickRecordToken(7, DATE, SECRET)).toMatch(/^q7\.2026-09-13\./);
  });

  describe('권한이 좁게 잘려 있다', () => {
    it('해변 번호를 바꾸면 서명이 깨진다 — A 링크로 B 해변을 기록할 수 없다', () => {
      const token = issueQuickRecordToken(7, DATE, SECRET);
      const tampered = token.replace(/^q7\./, 'q8.');

      expect(verifyQuickRecordToken(tampered, SECRET)).toBeNull();
    });

    it('날짜를 바꾸면 서명이 깨진다 — 어제 링크로 오늘을 기록할 수 없다', () => {
      const token = issueQuickRecordToken(7, DATE, SECRET);
      const tampered = token.replace('2026-09-13', '2026-09-14');

      expect(verifyQuickRecordToken(tampered, SECRET)).toBeNull();
    });

    it('다른 비밀키로 만든 토큰은 통하지 않는다', () => {
      const token = issueQuickRecordToken(7, DATE, 'another-secret-that-is-long-enough-here');

      expect(verifyQuickRecordToken(token, SECRET)).toBeNull();
    });

    it('지어낸 문자열은 통하지 않는다', () => {
      expect(verifyQuickRecordToken('q7.2026-09-13.AAAAAAAAAAAAAAAAAAAAAA', SECRET)).toBeNull();
    });

    it.each([
      ['빈 문자열', ''],
      ['접두사 없음', '7.2026-09-13.AAAAAAAAAAAAAAAAAAAAAA'],
      ['날짜 형식 오류', 'q7.20260913.AAAAAAAAAAAAAAAAAAAAAA'],
      ['서명 없음', 'q7.2026-09-13.'],
      ['해변 번호 0', 'q0.2026-09-13.AAAAAAAAAAAAAAAAAAAAAA'],
      ['게스트 토큰 모양', 'gV1sYQ2n8Kd0pZ7mR4tXbw.9fH2kLm3QaZ1cV8nT0yPxw'],
    ])('%s 는 거부한다', (_label, token) => {
      expect(verifyQuickRecordToken(token, SECRET)).toBeNull();
    });

    it('앞뒤 공백은 다듬는다 — 문자에서 복사하면 붙는다', () => {
      const token = issueQuickRecordToken(7, DATE, SECRET);

      expect(verifyQuickRecordToken(`  ${token}  `, SECRET)).not.toBeNull();
    });
  });

  it('날짜 만료는 여기서 판정하지 않는다 — "위조" 와 "어제 링크" 는 다르게 답해야 한다', () => {
    // 앞은 그냥 거부이고, 뒤는 "오늘 링크를 다시 받으세요" 다. 부르는 쪽이 구분할 수 있어야 한다.
    const yesterday = issueQuickRecordToken(7, parseKstDateKey('2026-09-12'), SECRET);

    expect(verifyQuickRecordToken(yesterday, SECRET)).toEqual({
      beachId: 7,
      dateKey: '2026-09-12',
    });
  });

  it('같은 해변·날짜면 항상 같은 토큰이다 — 링크를 다시 보내도 이전 것이 살아 있다', () => {
    // 난수를 섞으면 재발송 때마다 옛 링크가 죽는다. 문자를 두 번 받은 사람이 먼저 온 것을
    // 눌렀을 때 실패하면, 그 사람은 다시 시도하지 않는다.
    expect(issueQuickRecordToken(7, DATE, SECRET)).toBe(issueQuickRecordToken(7, DATE, SECRET));
  });
});
