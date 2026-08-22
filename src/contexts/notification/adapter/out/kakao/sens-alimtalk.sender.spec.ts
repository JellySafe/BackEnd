import { ConfigService } from '@nestjs/config';
import { SensAlimtalkSender, shouldFallback } from './sens-alimtalk.sender';
import { DisabledKakaoSender } from './disabled-kakao.sender';

/**
 * 알림톡 어댑터.
 *
 * ⚠️ 실제 사업자 계정으로 검증하지 못했다(SENS 계약 + 카카오 비즈니스 채널 + 템플릿 심사가
 *    필요하다). 그래서 **우리가 통제하는 부분**만 테스트로 고정한다 — 설정 해석, 템플릿 코드
 *    조회, 그리고 실패했을 때 문자로 넘길지 말지의 판정.
 *
 * 마지막 항목이 가장 중요하다. 잘못 판정하면 두 방향으로 나쁘다 —
 * 넘기지 말아야 할 때 넘기면 승인 템플릿이 어긋난 사실이 가려지고,
 * 넘겨야 할 때 안 넘기면 **카카오톡을 안 쓰는 사람은 경보를 아예 못 받는다.**
 */
describe('SensAlimtalkSender', () => {
  const FULL = {
    SENS_SERVICE_ID: 'sms-service',
    SENS_ACCESS_KEY: 'ak',
    SENS_SECRET_KEY: 'sk',
    SENS_FROM: '0212345678',
    KAKAO_SERVICE_ID: 'alimtalk-service',
    KAKAO_CHANNEL_ID: '@jellysafe',
    KAKAO_TEMPLATE_CODES: 'level_up:JELLY_LV_01, toxic_report:JELLY_TOXIC_01',
  };

  function sender(overrides: Record<string, string> = {}): SensAlimtalkSender {
    const config = new ConfigService({ ...FULL, ...overrides });
    const instance = new SensAlimtalkSender(config);
    jest.spyOn(instance['logger'], 'warn').mockImplementation(() => undefined);
    return instance;
  }

  describe('활성 조건', () => {
    it('SENS 자격증명과 카카오 채널이 모두 있으면 켜진다', () => {
      expect(sender().isEnabled()).toBe(true);
    });

    it.each(['KAKAO_CHANNEL_ID', 'KAKAO_SERVICE_ID', 'SENS_ACCESS_KEY'])(
      '%s 가 비면 꺼진다 — 부분 설정으로 보내다 전부 거부되는 것보다 낫다',
      (key) => {
        expect(sender({ [key]: '' }).isEnabled()).toBe(false);
      },
    );

    it('알림톡 서비스 ID 는 SMS 와 별개다 — 하나로 뭉뚱그리면 한쪽이 404 로 죽는다', () => {
      // 두 값이 다른 구성에서도 켜져야 한다.
      expect(sender({ KAKAO_SERVICE_ID: 'other-service' }).isEnabled()).toBe(true);
    });
  });

  describe('승인 템플릿 코드', () => {
    it('설정된 사건은 코드를 돌려준다', () => {
      expect(sender().templateCodeFor('level_up')).toBe('JELLY_LV_01');
      expect(sender().templateCodeFor('toxic_report')).toBe('JELLY_TOXIC_01');
    });

    it('공백이 섞여 있어도 읽는다 — 손으로 적는 설정값이다', () => {
      expect(
        sender({ KAKAO_TEMPLATE_CODES: '  level_up : JELLY_LV_01  ' }).templateCodeFor('level_up'),
      ).toBe('JELLY_LV_01');
    });

    it('승인되지 않은 사건은 null 이다 — 알림톡은 자유 문구를 보낼 수 없다', () => {
      expect(sender().templateCodeFor('sting_report')).toBeNull();
    });

    it('설정이 비어 있으면 전부 null 이다(문자로만 나간다)', () => {
      const s = sender({ KAKAO_TEMPLATE_CODES: '' });
      expect(s.templateCodeFor('level_up')).toBeNull();
    });

    it.each(['level_up', 'level_up:', ':CODE', 'garbage'])(
      '형식이 어긋난 항목 %p 는 버린다',
      (entry) => {
        expect(sender({ KAKAO_TEMPLATE_CODES: entry }).templateCodeFor('level_up')).toBeNull();
      },
    );
  });

  describe('실패했을 때 문자로 넘길지', () => {
    it('일시 실패(5xx·네트워크)는 넘긴다 — 사업자 사정으로 경보를 못 보내면 안 된다', () => {
      expect(shouldFallback(false, 'Internal Server Error')).toBe(true);
      expect(shouldFallback(false, 'The operation was aborted due to timeout')).toBe(true);
    });

    it('도달 불가(미가입·차단)는 넘긴다 — 장애가 아니라 정상이고 경보는 가야 한다', () => {
      expect(shouldFallback(true, '수신자가 카카오톡 미가입 상태입니다')).toBe(true);
      expect(shouldFallback(true, 'receiver blocked the channel')).toBe(true);
    });

    it.each([
      'template not found',
      '템플릿이 존재하지 않습니다',
      'message content does not match template',
      '발신프로필이 유효하지 않습니다',
    ])('템플릿·프로필 문제(%p)는 넘기지 않는다 — 문자로 보내면 그 사실이 가려진다', (reason) => {
      expect(shouldFallback(true, reason)).toBe(false);
    });
  });

  describe('비활성 어댑터', () => {
    it('예외를 던지지 않고 skipped 를 돌려준다', async () => {
      const disabled = new DisabledKakaoSender();
      jest.spyOn(disabled['logger'], 'log').mockImplementation(() => undefined);

      const outcome = await disabled.send();
      expect(outcome.status).toBe('skipped');
      expect(disabled.isEnabled()).toBe(false);
      expect(disabled.templateCodeFor()).toBeNull();
    });

    it('문자로 넘기라고 답한다 — 알림톡이 없다고 경보가 끊기면 안 된다', async () => {
      const disabled = new DisabledKakaoSender();
      jest.spyOn(disabled['logger'], 'log').mockImplementation(() => undefined);

      expect((await disabled.send()).shouldFallbackToSms).toBe(true);
    });
  });
});
