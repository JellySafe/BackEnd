import { DomainError } from '@shared/kernel/domain-error';
import { PushConsentRepositoryPort } from '../port/out/push-consent-repository.port';
import { PushSenderPort } from '../port/out/push-sender.port';
import { GetPushPublicKeyService } from './get-push-public-key.service';
import { RegisterPushSubscriptionService } from './register-push-subscription.service';
import { RevokePushSubscriptionService } from './revoke-push-subscription.service';

const SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH123456',
  keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa', auth: 'tBHItJI5svbpez7KI4CCXg' },
};

function consentRepo(overrides: Partial<PushConsentRepositoryPort> = {}) {
  return {
    upsert: jest.fn(async () => ({ consentId: 11, created: true })),
    revoke: jest.fn(async () => 1),
    revokeById: jest.fn(async () => undefined),
    findActive: jest.fn(async () => []),
    ...overrides,
  } as jest.Mocked<PushConsentRepositoryPort>;
}

/** 로그 소음 억제(구독 등록/해제 log). 서비스 인스턴스를 그대로 돌려준다. */
function quietRegister(service: RegisterPushSubscriptionService): RegisterPushSubscriptionService {
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return service;
}

function quietRevoke(service: RevokePushSubscriptionService): RevokePushSubscriptionService {
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  return service;
}

describe('RegisterPushSubscriptionService (구독 등록)', () => {
  it('비로그인 게스트 토큰으로 구독을 등록한다', async () => {
    const consents = consentRepo();
    const service = quietRegister(new RegisterPushSubscriptionService(consents));

    const res = await service.register({
      owner: { userId: null, userToken: 'guest-abc' },
      subscription: SUBSCRIPTION,
    });

    expect(res).toEqual({ consentId: 11, created: true });
    expect(consents.upsert).toHaveBeenCalledWith({
      owner: { userId: null, userToken: 'guest-abc' },
      subscription: SUBSCRIPTION,
      now: expect.any(Date),
    });
  });

  it('로그인 사용자는 userId 로 등록한다', async () => {
    const consents = consentRepo();
    const service = quietRegister(new RegisterPushSubscriptionService(consents));

    await service.register({
      owner: { userId: 5, userToken: null },
      subscription: SUBSCRIPTION,
    });

    expect(consents.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner: { userId: 5, userToken: null } }),
    );
  });

  it('같은 endpoint 재등록은 멱등이다 (브라우저는 앱 열 때마다 구독을 다시 보낸다)', async () => {
    const consents = consentRepo({
      upsert: jest.fn(async () => ({ consentId: 11, created: false })),
    });
    const service = quietRegister(new RegisterPushSubscriptionService(consents));

    const res = await service.register({
      owner: { userId: null, userToken: 'guest-abc' },
      subscription: SUBSCRIPTION,
    });

    expect(res.created).toBe(false); // 에러가 아니다. 행이 늘지 않았을 뿐.
  });

  it('소유자(userToken/userId)가 없으면 거부한다 — 보낼 대상을 특정할 수 없다', async () => {
    const consents = consentRepo();
    const service = quietRegister(new RegisterPushSubscriptionService(consents));

    await expect(
      service.register({
        owner: { userId: null, userToken: null },
        subscription: SUBSCRIPTION,
      }),
    ).rejects.toThrow(DomainError);
    expect(consents.upsert).not.toHaveBeenCalled();
  });

  it('깨진 구독 정보는 저장하지 않는다 (저장하면 발송 때마다 실패한다)', async () => {
    const consents = consentRepo();
    const service = quietRegister(new RegisterPushSubscriptionService(consents));

    await expect(
      service.register({
        owner: { userId: null, userToken: 'guest-abc' },
        subscription: { endpoint: 'https://fcm.googleapis.com/x' }, // keys 없음
      }),
    ).rejects.toThrow(DomainError);
    expect(consents.upsert).not.toHaveBeenCalled();
  });
});

describe('RevokePushSubscriptionService (구독 해제)', () => {
  it('endpoint 를 주면 그 기기만 해제한다', async () => {
    const consents = consentRepo();
    const service = quietRevoke(new RevokePushSubscriptionService(consents));

    const res = await service.revoke({
      owner: { userId: null, userToken: 'guest-abc' },
      endpoint: SUBSCRIPTION.endpoint,
    });

    expect(res).toEqual({ revokedCount: 1 });
    expect(consents.revoke).toHaveBeenCalledWith({
      owner: { userId: null, userToken: 'guest-abc' },
      endpoint: SUBSCRIPTION.endpoint,
      now: expect.any(Date),
    });
  });

  it('endpoint 를 생략하면 이 사용자의 모든 구독을 해제한다', async () => {
    const consents = consentRepo({ revoke: jest.fn(async () => 3) });
    const service = quietRevoke(new RevokePushSubscriptionService(consents));

    const res = await service.revoke({ owner: { userId: 5, userToken: null } });

    expect(res).toEqual({ revokedCount: 3 });
    expect(consents.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: null }),
    );
  });

  it('해제할 구독이 없어도 에러가 아니다 (멱등)', async () => {
    const consents = consentRepo({ revoke: jest.fn(async () => 0) });
    const service = quietRevoke(new RevokePushSubscriptionService(consents));

    await expect(
      service.revoke({ owner: { userId: null, userToken: 'guest-abc' } }),
    ).resolves.toEqual({ revokedCount: 0 });
  });

  it('소유자가 없으면 거부한다 (전체 구독을 날리는 사고 방지)', async () => {
    const consents = consentRepo();
    const service = quietRevoke(new RevokePushSubscriptionService(consents));

    await expect(
      service.revoke({ owner: { userId: null, userToken: null } }),
    ).rejects.toThrow(DomainError);
    expect(consents.revoke).not.toHaveBeenCalled();
  });
});

describe('GetPushPublicKeyService (VAPID 공개키 조회)', () => {
  function senderStub(configured: boolean): PushSenderPort {
    return {
      isConfigured: () => configured,
      getPublicKey: () => (configured ? 'BHgV6psvw1HxQetCksBDDtBCqk7dyA4' : null),
      send: jest.fn(),
    };
  }

  it('키가 설정돼 있으면 공개키를 내려준다', () => {
    const service = new GetPushPublicKeyService(senderStub(true));

    expect(service.getPublicKey()).toEqual({
      publicKey: 'BHgV6psvw1HxQetCksBDDtBCqk7dyA4',
      configured: true,
    });
  });

  it('키가 없으면 configured=false 로 알려준다 (프론트가 구독 UI 를 숨긴다)', () => {
    const service = new GetPushPublicKeyService(senderStub(false));

    // 부팅은 막지 않는다. 인앱 알림함은 그대로 동작해야 한다.
    expect(service.getPublicKey()).toEqual({ publicKey: null, configured: false });
  });
});
