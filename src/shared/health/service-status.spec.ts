import { SUPPORTED_LOCALES } from '@shared/i18n/locale';
import {
  DELAYED_AFTER_MINUTES,
  STALE_AFTER_MINUTES,
  evaluateServiceStatus,
} from './service-status';

/**
 * 시민용 서비스 상태.
 *
 * 여기서 지키는 것은 **"모르는 것을 정상이라고 하지 않는 것"** 이다. 화면의 위험도가 6시간
 * 전 값인데 배너가 "정상" 이라고 떠 있으면, 사용자는 낡은 '낮음' 을 현재로 믿고 물에 들어간다.
 */
describe('서비스 상태 판정', () => {
  const MIN = 60;

  describe('경계', () => {
    it('방금 갱신됐으면 정상이다', () => {
      expect(evaluateServiceStatus(0).status).toBe('ok');
    });

    it('한 주기(30분)를 걸러도 정상이다 — 일시적 실패를 매번 알리면 경고가 무뎌진다', () => {
      expect(evaluateServiceStatus(45 * MIN).status).toBe('ok');
    });

    it(`${DELAYED_AFTER_MINUTES}분까지는 정상이다`, () => {
      expect(evaluateServiceStatus(DELAYED_AFTER_MINUTES * MIN).status).toBe('ok');
    });

    it(`${DELAYED_AFTER_MINUTES}분을 넘으면 지연이다`, () => {
      expect(evaluateServiceStatus((DELAYED_AFTER_MINUTES + 1) * MIN).status).toBe('delayed');
    });

    it(`${STALE_AFTER_MINUTES}분까지는 지연이다`, () => {
      expect(evaluateServiceStatus(STALE_AFTER_MINUTES * MIN).status).toBe('delayed');
    });

    it(`${STALE_AFTER_MINUTES}분을 넘으면 낡음이다 — 현재로 믿으면 안 된다`, () => {
      expect(evaluateServiceStatus((STALE_AFTER_MINUTES + 1) * MIN).status).toBe('stale');
    });
  });

  describe('모르는 것을 정상이라고 하지 않는다', () => {
    it('산출 이력이 없으면 정상이 아니라 낡음이다', () => {
      // 보여줄 값이 아예 없는 상태다. "정상" 이라고 답하면 사용자가 빈 화면을 신뢰한다.
      const view = evaluateServiceStatus(null);

      expect(view.status).toBe('stale');
      expect(view.riskUpdatedMinutesAgo).toBeNull();
    });
  });

  describe('경과 시간', () => {
    it('분 단위로 내림한다', () => {
      expect(evaluateServiceStatus(119).riskUpdatedMinutesAgo).toBe(1);
    });

    it('음수가 나오지 않는다 — 시계 어긋남이 "-3분 전" 으로 보이면 안 된다', () => {
      expect(evaluateServiceStatus(-120).riskUpdatedMinutesAgo).toBe(0);
    });
  });

  describe('문구', () => {
    it.each(SUPPORTED_LOCALES)('%s: 세 상태 모두 문구가 있다', (locale) => {
      for (const seconds of [0, 90 * MIN, 300 * MIN]) {
        expect(evaluateServiceStatus(seconds, locale).message.length).toBeGreaterThan(0);
      }
    });

    it('상태마다 다른 문구다 — 같으면 배너를 나눈 의미가 없다', () => {
      const messages = [0, 90 * MIN, 300 * MIN].map((s) => evaluateServiceStatus(s).message);
      expect(new Set(messages).size).toBe(3);
    });

    it('낡음 문구는 "기다리라" 고 하지 않는다 — 할 일은 현장 안내를 따르는 것이다', () => {
      const message = evaluateServiceStatus(300 * MIN).message;

      expect(message).not.toContain('잠시');
      expect(message).toContain('현장');
    });

    it('지연·낡음 문구가 값이 최신이 아닐 수 있음을 말한다', () => {
      expect(evaluateServiceStatus(90 * MIN).message).toContain('최신');
      expect(evaluateServiceStatus(300 * MIN).message).toContain('다를 수 있습니다');
    });

    it('언어를 주지 않으면 한국어다', () => {
      expect(evaluateServiceStatus(0).message).toMatch(/[가-힣]/);
    });

    it('영어로도 나온다', () => {
      expect(evaluateServiceStatus(0, 'en').message).not.toMatch(/[가-힣]/);
    });
  });
});
