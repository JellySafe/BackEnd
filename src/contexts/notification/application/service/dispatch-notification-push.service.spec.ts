import { ConfigService } from '@nestjs/config';
import { Id } from '@shared/kernel/id';
import { WebPushSubscription } from '../../domain/push-subscription';
import { DispatchNotificationPushCommand } from '../port/in/notification-use-cases';
import {
  FinishDispatchInput,
  NotificationDispatchRepositoryPort,
  StartDispatchInput,
} from '../port/out/notification-dispatch-repository.port';
import {
  PushConsentOwner,
  PushConsentRecord,
  PushConsentRepositoryPort,
} from '../port/out/push-consent-repository.port';
import {
  PushPayload,
  PushSenderPort,
  PushSendOutcome,
  PushSendStatus,
} from '../port/out/push-sender.port';
import { DispatchNotificationPushService } from './dispatch-notification-push.service';

const NOTIFICATION_ID = 555;
const OWNER: PushConsentOwner = { userId: null, userToken: 'guest-abc' };

function consent(consentId: Id, tail = String(consentId)): PushConsentRecord {
  return {
    consentId,
    subscription: {
      endpoint: `https://fcm.googleapis.com/fcm/send/sub-${tail}`,
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    },
  };
}

function outcome(status: PushSendStatus, statusCode: number | null = null): PushSendOutcome {
  return {
    status,
    statusCode,
    failedReason: status === 'sent' ? null : `${statusCode ?? ''} 실패`,
  };
}

function command(
  overrides: Partial<DispatchNotificationPushCommand> = {},
): DispatchNotificationPushCommand {
  return {
    notificationId: NOTIFICATION_ID,
    owner: OWNER,
    beachId: 7,
    title: '해파리 위험 경보',
    message: '협재해수욕장 위험 단계가 상승했습니다.',
    riskLevel: 'danger',
    eventType: 'level_up',
    dedupKey: 'dedup-1',
    now: new Date('2026-07-14T09:00:00Z'),
    ...overrides,
  };
}

/** 발송 이력을 인메모리로 재현하는 스텁. 실제 행이 어떤 상태로 남는지 검증한다. */
function dispatchRepo() {
  const rows: Array<StartDispatchInput & Partial<FinishDispatchInput> & { id: Id }> = [];
  let seq = 0;
  const repo: NotificationDispatchRepositoryPort = {
    start: jest.fn(async (input: StartDispatchInput) => {
      seq += 1;
      rows.push({ ...input, id: seq, status: 'pending' as never });
      return seq;
    }),
    finish: jest.fn(async (input: FinishDispatchInput) => {
      const row = rows.find((r) => r.id === input.dispatchId);
      if (row) Object.assign(row, input);
    }),
  };
  return { repo, rows };
}

function setup(options: {
  configured?: boolean;
  consents?: PushConsentRecord[];
  send?: (sub: WebPushSubscription, payload: PushPayload) => Promise<PushSendOutcome>;
}) {
  const configured = options.configured ?? true;
  const records = options.consents ?? [consent(1)];

  const sender: PushSenderPort = {
    isConfigured: jest.fn(() => configured),
    getPublicKey: jest.fn(() => (configured ? 'public-key' : null)),
    send: jest.fn(options.send ?? (() => Promise.resolve(outcome('sent', 201)))),
  };

  const consents: PushConsentRepositoryPort = {
    upsert: jest.fn(),
    revoke: jest.fn(),
    revokeById: jest.fn(async () => undefined),
    findActive: jest.fn(async () => records),
  };

  const { repo, rows } = dispatchRepo();
  // 환경 변수 없음 → 기본값(PUSH_CONCURRENCY=5) 사용.
  const config = { get: () => undefined } as unknown as ConfigService;
  const service = new DispatchNotificationPushService(config, sender, consents, repo);
  jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, sender, consents, dispatches: repo, rows };
}

describe('DispatchNotificationPushService (Web Push 실제 발송)', () => {
  it('구독자에게 푸시를 보내고 notification_dispatches 에 sent 로 기록한다', async () => {
    const { service, sender, rows } = setup({ consents: [consent(1)] });

    const res = await service.dispatch(command());

    expect(res).toEqual({ skipped: false, attempted: 1, sent: 1, failed: 0, expired: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);

    // 발송 이력이 남는다: pending 으로 시작해 sent 로 확정된다.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notificationId: NOTIFICATION_ID,
      channel: 'push',
      provider: 'web-push',
      status: 'sent',
      failedReason: null,
    });
    expect(rows[0].sentAt).toBeInstanceOf(Date);
  });

  it('recipient 는 마스킹되어 저장된다 — endpoint 원문이 DB 에 남지 않는다', async () => {
    const { service, rows } = setup({ consents: [consent(1, 'secret-token-xyz')] });

    await service.dispatch(command());

    expect(rows[0].recipient).not.toContain('secret-token-xyz');
    expect(rows[0].recipient).toContain('fcm.googleapis.com');
    expect(rows[0].recipient.length).toBeLessThanOrEqual(255);
  });

  it('서비스워커가 표시할 페이로드(제목/본문/해변/위험단계)를 담아 보낸다', async () => {
    const { service, sender } = setup({});

    await service.dispatch(command());

    const payload = (sender.send as jest.Mock).mock.calls[0][1] as PushPayload;
    expect(payload).toMatchObject({
      notificationId: NOTIFICATION_ID,
      title: '해파리 위험 경보',
      body: '협재해수욕장 위험 단계가 상승했습니다.',
      beachId: 7,
      riskLevel: 'danger',
      eventType: 'level_up',
      tag: 'dedup-1', // 같은 dedupKey 알림은 브라우저 알림창에서 덮어쓰기 된다.
    });
  });

  it('제목이 없는 자동 알림은 서비스명으로 폴백한다(제목 없는 브라우저 알림 방지)', async () => {
    const { service, sender } = setup({});

    await service.dispatch(command({ title: null }));

    const payload = (sender.send as jest.Mock).mock.calls[0][1] as PushPayload;
    expect(payload.title).toBe('JellySafe 해파리 알림');
  });

  // ── 핵심: 구독 만료 처리 ────────────────────────────────────────────────────────
  it('410 Gone 이면 구독을 무효화하고 rejected 로 기록한다 (재시도하지 않는다)', async () => {
    const { service, consents, rows } = setup({
      consents: [consent(42)],
      send: () => Promise.resolve(outcome('expired', 410)),
    });

    const res = await service.dispatch(command());

    // 만료는 failed 가 아니다 — 재시도 대상으로 세면 죽은 구독에 영원히 보내게 된다.
    expect(res).toEqual({ skipped: false, attempted: 1, sent: 0, failed: 0, expired: 1 });
    // 그 구독만 정확히 무효화된다(revoked_at).
    expect(consents.revokeById).toHaveBeenCalledWith(42, expect.any(Date));
    // 이력은 rejected(영구 실패)로 확정 — failed 였다면 재시도 큐에 들어간다.
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].sentAt).toBeNull();
  });

  it('404 도 만료로 다룬다 (FCM 이 404 로 답하는 경우)', async () => {
    const { service, consents } = setup({
      consents: [consent(7)],
      send: () => Promise.resolve(outcome('expired', 404)),
    });

    const res = await service.dispatch(command());

    expect(res.expired).toBe(1);
    expect(consents.revokeById).toHaveBeenCalledWith(7, expect.any(Date));
  });

  it('일시 실패(5xx)는 failed 로 남기고 구독은 살려둔다 (재시도 가능)', async () => {
    const { service, consents, rows } = setup({
      consents: [consent(9)],
      send: () => Promise.resolve(outcome('failed', 503)),
    });

    const res = await service.dispatch(command());

    expect(res).toEqual({ skipped: false, attempted: 1, sent: 0, failed: 1, expired: 0 });
    // 일시 장애로 구독을 끊으면 멀쩡한 사용자가 알림을 영영 못 받는다.
    expect(consents.revokeById).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('failed');
    expect(rows[0].failedReason).toContain('503');
  });

  it('영구 거부(400/403)는 rejected 로 남기지만 구독을 끊지는 않는다', async () => {
    const { service, consents, rows } = setup({
      consents: [consent(3)],
      send: () => Promise.resolve(outcome('rejected', 403)),
    });

    const res = await service.dispatch(command());

    // 403 은 보통 우리 VAPID 키 설정 문제다. 사용자 구독을 끊을 이유가 아니다.
    expect(res.failed).toBe(0);
    expect(res.sent).toBe(0);
    expect(consents.revokeById).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('rejected');
  });

  // ── 다수 구독자 ────────────────────────────────────────────────────────────────
  it('여러 구독에 병렬로 보내고 결과를 개별 집계한다 (한 건 실패가 다른 건을 막지 않는다)', async () => {
    const consents = [consent(1), consent(2), consent(3), consent(4)];
    const { service, rows } = setup({
      consents,
      send: (sub) => {
        if (sub.endpoint.endsWith('sub-2')) return Promise.resolve(outcome('expired', 410));
        if (sub.endpoint.endsWith('sub-3')) return Promise.resolve(outcome('failed', 500));
        return Promise.resolve(outcome('sent', 201));
      },
    });

    const res = await service.dispatch(command());

    expect(res).toEqual({ skipped: false, attempted: 4, sent: 2, failed: 1, expired: 1 });
    // 4건 모두 이력이 남는다 — 누락 없음.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'rejected', 'sent', 'sent']);
  });

  it('구독 수가 동시 처리 한계를 넘어도 전원에게 정확히 1회씩 보낸다(제한 병렬)', async () => {
    // 기본 PUSH_CONCURRENCY=5 를 넘는 12건 → 청크 경계에서 누락/중복이 없어야 한다.
    const consents = Array.from({ length: 12 }, (_, i) => consent(i + 1));
    const { service, sender, rows } = setup({ consents });

    const res = await service.dispatch(command());

    expect(res).toMatchObject({ attempted: 12, sent: 12 });
    expect(sender.send).toHaveBeenCalledTimes(12);
    expect(rows).toHaveLength(12);
  });

  it('동시 발송 수를 제한한다 (무제한 병렬로 소켓을 고갈시키지 않는다)', async () => {
    let inFlight = 0;
    let peak = 0;
    const consents = Array.from({ length: 12 }, (_, i) => consent(i + 1));
    const { service } = setup({
      consents,
      send: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return outcome('sent', 201);
      },
    });

    await service.dispatch(command());

    // 순차(1)도 아니고 무제한(12)도 아닌, 설정된 상한(기본 5) 이하여야 한다.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  // ── 건너뛰기 (앱은 정상 동작해야 한다) ──────────────────────────────────────────
  it('VAPID 키가 없으면 발송을 건너뛴다 — 조회조차 하지 않는다', async () => {
    const { service, sender, consents, rows } = setup({ configured: false });

    const res = await service.dispatch(command());

    expect(res).toEqual({ skipped: true, attempted: 0, sent: 0, failed: 0, expired: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    expect(consents.findActive).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0); // 시도하지 않았으므로 이력도 남기지 않는다.
  });

  it('푸시에 동의하지 않은 사용자는 건너뛴다 (인앱 알림함으로만 받는다)', async () => {
    const { service, sender } = setup({ consents: [] });

    const res = await service.dispatch(command());

    expect(res.skipped).toBe(true);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('브로드캐스트 알림(admin/operator: 수신자 미특정)은 보낼 곳이 없어 건너뛴다', async () => {
    const { service, sender, consents } = setup({});

    const res = await service.dispatch(
      command({ owner: { userId: null, userToken: null } }),
    );

    expect(res.skipped).toBe(true);
    expect(consents.findActive).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  // ── 예외 격리 ─────────────────────────────────────────────────────────────────
  it('구독 조회가 터져도 예외를 던지지 않는다 (알림 생성을 롤백시키면 안 된다)', async () => {
    const { service, consents } = setup({});
    (consents.findActive as jest.Mock).mockRejectedValue(new Error('DB 커넥션 오류'));

    await expect(service.dispatch(command())).resolves.toEqual({
      skipped: false,
      attempted: 0,
      sent: 0,
      failed: 0,
      expired: 0,
    });
  });

  it('이력 기록이 실패하면 발송하지 않는다 (추적 불가능한 발송을 만들지 않는다)', async () => {
    const { service, sender, dispatches } = setup({});
    (dispatches.start as jest.Mock).mockRejectedValue(new Error('INSERT 실패'));

    const res = await service.dispatch(command());

    expect(sender.send).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it('발송 후 이력 갱신이 실패해도 예외를 던지지 않는다 (pending 으로 남아 추적된다)', async () => {
    const { service, dispatches } = setup({});
    (dispatches.finish as jest.Mock).mockRejectedValue(new Error('UPDATE 실패'));

    await expect(service.dispatch(command())).resolves.toMatchObject({ sent: 1 });
  });
});
