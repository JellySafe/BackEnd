import { ConfigService } from '@nestjs/config';
import { DispatchNotificationSmsService } from './dispatch-notification-sms.service';
import { ManageNotificationConsentService } from './manage-notification-consent.service';
import { PushConsentRepositoryPort } from '../port/out/push-consent-repository.port';
import { SmsConsentRepositoryPort } from '../port/out/sms-consent-repository.port';
import { SmsSenderPort, SmsSendOutcome } from '../port/out/sms-sender.port';
import {
  KakaoMessage,
  KakaoSenderPort,
  KakaoSendOutcome,
} from '../port/out/kakao-sender.port';
import {
  FinishDispatchInput,
  NotificationDispatchRepositoryPort,
  StartDispatchInput,
} from '../port/out/notification-dispatch-repository.port';

/**
 * 문자 발송과 수신 동의 관리.
 *
 * 문자는 **건당 과금 + 사용자 방해가 큰 채널**이라, "언제 보내지 않는가" 가 "어떻게 보내는가"
 * 만큼 중요하다. 그 문턱들(사업자 미설정·동의 없음·위험 단계 미달)을 테스트로 고정한다.
 */

const OWNER = { userId: null, userToken: 'gAAAA' };
const PHONE = '01012345678';

function senderStub(outcome: SmsSendOutcome, enabled = true): jest.Mocked<SmsSenderPort> {
  return {
    isEnabled: jest.fn(() => enabled),
    providerName: jest.fn(() => 'test-provider'),
    send: jest.fn((_message) => Promise.resolve(outcome)),
  };
}

function dispatchStub() {
  const started: StartDispatchInput[] = [];
  const finished: FinishDispatchInput[] = [];
  const port: NotificationDispatchRepositoryPort = {
    start: (input) => {
      started.push(input);
      return Promise.resolve(started.length);
    },
    finish: (input) => {
      finished.push(input);
      return Promise.resolve();
    },
  };
  return { port, started, finished };
}

function consentStub(phoneNumber: string | null = PHONE): SmsConsentRepositoryPort {
  return {
    upsert: jest.fn().mockResolvedValue({ consentId: 1, created: true }),
    revoke: jest.fn().mockResolvedValue(1),
    findActive: jest
      .fn()
      .mockResolvedValue(phoneNumber === null ? null : { consentId: 1, phoneNumber }),
  };
}

/**
 * 알림톡 스텁. 기본은 **꺼짐** — 기존 테스트가 보는 것은 문자 경로이고,
 * 알림톡이 기본으로 켜지면 그 테스트들이 전부 알림톡 경로를 타게 된다.
 */
function kakaoStub(
  options: { enabled?: boolean; templateCode?: string | null; outcome?: KakaoSendOutcome } = {},
): { port: KakaoSenderPort; sent: KakaoMessage[] } {
  const sent: KakaoMessage[] = [];
  return {
    sent,
    port: {
      isEnabled: () => options.enabled ?? false,
      providerName: () => 'kakao-stub',
      templateCodeFor: () => options.templateCode ?? null,
      send: (message: KakaoMessage) => {
        sent.push(message);
        return Promise.resolve(
          options.outcome ?? {
            status: 'sent' as const,
            statusCode: 202,
            failedReason: null,
            shouldFallbackToSms: false,
          },
        );
      },
    },
  };
}

describe('DispatchNotificationSmsService', () => {
  const SENT: SmsSendOutcome = { status: 'sent', statusCode: 202, failedReason: null };

  function build(options: {
    outcome?: SmsSendOutcome;
    enabled?: boolean;
    phoneNumber?: string | null;
    minRiskLevel?: string;
    kakao?: { enabled?: boolean; templateCode?: string | null; outcome?: KakaoSendOutcome };
  } = {}) {
    const sender = senderStub(options.outcome ?? SENT, options.enabled ?? true);
    const consents = consentStub(options.phoneNumber === undefined ? PHONE : options.phoneNumber);
    const dispatches = dispatchStub();
    const kakao = kakaoStub(options.kakao);
    const service = new DispatchNotificationSmsService(
      new ConfigService({ SMS_MIN_RISK_LEVEL: options.minRiskLevel ?? 'danger' }),
      sender,
      kakao.port,
      consents,
      dispatches.port,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    return { service, sender, consents, dispatches, kakao };
  }

  const command = (riskLevel: 'safe' | 'caution' | 'danger' | null = 'danger') => ({
    notificationId: 42,
    owner: OWNER,
    message: '협재해수욕장 위험 단계가 위험으로 올랐습니다.',
    riskLevel,
  });

  it('동의한 번호로 보내고 발송 이력을 남긴다', async () => {
    const { service, sender, dispatches } = build();

    const result = await service.dispatch(command());

    expect(result).toEqual({ skipped: false, sent: true, reason: null });
    expect(sender.send).toHaveBeenCalledWith({ to: PHONE, body: command().message });
    expect(dispatches.finished[0].status).toBe('sent');
  });

  it('발송 이력에는 마스킹된 번호만 남긴다 — 운영 화면·로그에서 그대로 읽히는 값이다', async () => {
    const { service, dispatches } = build();

    await service.dispatch(command());

    expect(dispatches.started[0].recipient).toBe('010-****-5678');
    expect(JSON.stringify(dispatches.started)).not.toContain(PHONE);
  });

  it('위험 단계 미달이면 보내지 않는다 (기본 danger 이상) — 과금·알림 피로 관리', async () => {
    const { service, sender } = build();

    const result = await service.dispatch(command('caution'));

    expect(result.reason).toBe('below_threshold');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('문턱을 caution 으로 낮추면 주의 단계도 보낸다', async () => {
    const { service, sender } = build({ minRiskLevel: 'caution' });

    await service.dispatch(command('caution'));

    expect(sender.send).toHaveBeenCalled();
  });

  it('위험 단계를 모르는 알림(수동 발송 등)은 보내지 않는다 — 과금되는 채널이다', async () => {
    const { service, sender } = build();

    const result = await service.dispatch(command(null));

    expect(result.sent).toBe(false);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('사업자가 꺼져 있으면 수신자 조회도 하지 않는다', async () => {
    const { service, consents, sender } = build({ enabled: false });

    const result = await service.dispatch(command());

    expect(result).toEqual({ skipped: true, sent: false, reason: null });
    expect(consents.findActive).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('수신 동의가 없으면 아무것도 하지 않는다', async () => {
    const { service, sender, dispatches } = build({ phoneNumber: null });

    const result = await service.dispatch(command());

    expect(result.skipped).toBe(true);
    expect(sender.send).not.toHaveBeenCalled();
    expect(dispatches.started).toHaveLength(0);
  });

  it('영구 거부(rejected)는 그대로 기록한다 — 재시도 대상이 아니다', async () => {
    const { service, dispatches } = build({
      outcome: { status: 'rejected', statusCode: 400, failedReason: '발신번호 미등록' },
    });

    const result = await service.dispatch(command());

    expect(result.sent).toBe(false);
    expect(dispatches.finished[0].status).toBe('rejected');
    expect(dispatches.finished[0].failedReason).toBe('발신번호 미등록');
  });

  it('일시 실패(failed)도 기록한다 — 나중에 재시도할 수 있는 상태로 남는다', async () => {
    const { service, dispatches } = build({
      outcome: { status: 'failed', statusCode: 503, failedReason: '사업자 점검' },
    });

    await service.dispatch(command());

    expect(dispatches.finished[0].status).toBe('failed');
    expect(dispatches.finished[0].sentAt).toBeNull();
  });

  it('저장소가 터져도 예외를 던지지 않는다 — 알림 생성과 위험도 배치를 무너뜨리면 안 된다', async () => {
    const { service, consents } = build();
    (consents.findActive as jest.Mock).mockRejectedValue(new Error('DB 연결 끊김'));

    await expect(service.dispatch(command())).resolves.toEqual({
      skipped: true,
      sent: false,
      reason: 'internal_error',
    });
  });

  describe('알림톡 우선 발송', () => {
    const KAKAO_ON = { enabled: true, templateCode: 'JELLY_LV_01' };

    it('알림톡이 접수되면 문자는 보내지 않는다 — 같은 사람에게 두 번 가면 안 된다', async () => {
      const { service, sender, kakao, dispatches } = build({ kakao: KAKAO_ON });

      const result = await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '협재해수욕장 위험도가 위험 단계입니다.',
        riskLevel: 'danger',
        eventType: 'level_up',
      });

      expect(result).toEqual({ skipped: false, sent: true, reason: null });
      expect(kakao.sent).toHaveLength(1);
      expect(kakao.sent[0].templateCode).toBe('JELLY_LV_01');
      expect(sender.send).toHaveBeenCalledTimes(0);
      // 발송 이력은 kakao 채널로 남아야 비용·도달을 채널별로 셀 수 있다.
      expect(dispatches.started[0].channel).toBe('kakao');
    });

    it('사건 종류가 없으면 알림톡을 건너뛴다 — 템플릿을 고를 수 없다', async () => {
      const { service, sender, kakao } = build({ kakao: KAKAO_ON });

      await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '수동 발송',
        riskLevel: 'danger',
      });

      expect(kakao.sent).toHaveLength(0);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('승인된 템플릿이 없는 사건은 문자로 간다', async () => {
      const { service, sender, kakao } = build({
        kakao: { enabled: true, templateCode: null },
      });

      await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '쏘임 사고 발생',
        riskLevel: 'danger',
        eventType: 'sting_report',
      });

      expect(kakao.sent).toHaveLength(0);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('도달 불가(미가입·차단)면 문자로 넘긴다 — 경보는 그래도 가야 한다', async () => {
      const { service, sender, kakao, dispatches } = build({
        kakao: {
          ...KAKAO_ON,
          outcome: {
            status: 'rejected',
            statusCode: 400,
            failedReason: '카카오톡 미가입',
            shouldFallbackToSms: true,
          },
        },
      });

      const result = await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '위험 상승',
        riskLevel: 'danger',
        eventType: 'level_up',
      });

      expect(result.sent).toBe(true);
      expect(kakao.sent).toHaveLength(1);
      expect(sender.send).toHaveBeenCalledTimes(1); // 문자로 실제로 나갔다
      // 두 채널의 시도가 모두 이력에 남는다(무엇이 나갔는지 셀 수 있어야 한다).
      expect(dispatches.started.map((d) => d.channel)).toEqual(['kakao', 'sms']);
    });

    it('템플릿 문제면 문자로 넘기지 않는다 — 문구가 어긋난 사실이 가려진다', async () => {
      const { service, sender, kakao } = build({
        kakao: {
          ...KAKAO_ON,
          outcome: {
            status: 'rejected',
            statusCode: 400,
            failedReason: 'template not found',
            shouldFallbackToSms: false,
          },
        },
      });

      const result = await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '위험 상승',
        riskLevel: 'danger',
        eventType: 'level_up',
      });

      expect(result).toEqual({ skipped: false, sent: false, reason: 'rejected' });
      expect(kakao.sent).toHaveLength(1);
      expect(sender.send).toHaveBeenCalledTimes(0);
    });

    it('알림톡이 꺼져 있으면 기존 문자 경로 그대로다', async () => {
      const { service, sender, kakao } = build({ kakao: { enabled: false } });

      await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '위험 상승',
        riskLevel: 'danger',
        eventType: 'level_up',
      });

      expect(kakao.sent).toHaveLength(0);
      expect(sender.send).toHaveBeenCalledTimes(1);
    });

    it('위험 단계 문턱은 알림톡에도 그대로 걸린다 — 주의 단계는 두 채널 다 안 보낸다', async () => {
      const { service, sender, kakao } = build({ kakao: KAKAO_ON });

      const result = await service.dispatch({
        notificationId: 1,
        owner: OWNER,
        message: '주의',
        riskLevel: 'caution',
        eventType: 'level_up',
      });

      expect(result.reason).toBe('below_threshold');
      expect(kakao.sent).toHaveLength(0);
      expect(sender.send).toHaveBeenCalledTimes(0);
    });
  });

});

describe('ManageNotificationConsentService', () => {
  function build(options: { enabled?: boolean; phoneNumber?: string | null } = {}) {
    const smsConsents = consentStub(
      options.phoneNumber === undefined ? PHONE : options.phoneNumber,
    );
    const pushConsents = {
      upsert: jest.fn(),
      revoke: jest.fn(),
      revokeById: jest.fn(),
      findActive: jest.fn().mockResolvedValue([{ consentId: 1 }, { consentId: 2 }]),
    } as unknown as PushConsentRepositoryPort;
    const sender = senderStub(
      { status: 'skipped', statusCode: null, failedReason: null },
      options.enabled ?? false,
    );
    return {
      service: new ManageNotificationConsentService(
        new ConfigService({}),
        pushConsents,
        smsConsents,
        sender,
      ),
      smsConsents,
    };
  }

  it('채널별 상태를 함께 돌려준다 (푸시 기기 수 + 문자 동의)', async () => {
    const { service } = build({ enabled: true });

    const status = await service.status(OWNER);

    expect(status.push.subscriptions).toBe(2);
    expect(status.sms).toEqual({
      agreed: true,
      phoneNumber: '010-****-5678',
      available: true,
      minRiskLevel: 'danger',
    });
  });

  it('사업자가 없으면 available=false — 동의했는데 문자가 안 오는 이유를 화면에서 구분할 수 있다', async () => {
    const { service } = build({ enabled: false });

    expect((await service.status(OWNER)).sms.available).toBe(false);
  });

  it('번호는 응답에 원문으로 나가지 않는다', async () => {
    const { service } = build();

    const status = await service.status(OWNER);

    expect(JSON.stringify(status)).not.toContain(PHONE);
  });

  it('여러 표기로 등록해도 저장은 한 형태다', async () => {
    const { service, smsConsents } = build();

    const result = await service.registerSms({ owner: OWNER, phoneNumber: '010-1234-5678' });

    expect(smsConsents.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '01012345678' }),
    );
    expect(result.phoneNumber).toBe('010-****-5678');
  });

  it('휴대폰 번호가 아니면 등록하지 않는다', async () => {
    const { service, smsConsents } = build();

    await expect(
      service.registerSms({ owner: OWNER, phoneNumber: '02-123-4567' }),
    ).rejects.toMatchObject({ code: 'PHONE_NUMBER_INVALID' });
    expect(smsConsents.upsert).not.toHaveBeenCalled();
  });

  it('동의한 적 없어도 수신 거부는 성공이다(멱등)', async () => {
    const { service, smsConsents } = build({ phoneNumber: null });
    (smsConsents.revoke as jest.Mock).mockResolvedValue(0);

    await expect(service.revokeSms(OWNER)).resolves.toEqual({ revoked: 0 });
  });
});
