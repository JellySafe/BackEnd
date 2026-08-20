import { NotificationValue } from '../../domain/notification';
import {
  CreateNotificationCommand,
  DispatchNotificationPushResult,
  DispatchNotificationPushUseCase,
  DispatchNotificationSmsUseCase,
} from '../port/in/notification-use-cases';
import {
  NotificationRepositoryPort,
  SaveResult,
} from '../port/out/notification-repository.port';
import { NotificationQueryPort } from '../port/out/notification-query.port';
import { TemplateQueryPort } from '../port/out/template-query.port';
import { CreateNotificationService } from './create-notification.service';

const NOTIFICATION_ID = 900;

const NO_PUSH: DispatchNotificationPushResult = {
  skipped: true,
  attempted: 0,
  sent: 0,
  failed: 0,
  expired: 0,
};

function setup(options: {
  save?: (value: NotificationValue) => Promise<SaveResult>;
  existsByDedupKey?: boolean;
  dispatch?: (command: unknown) => Promise<DispatchNotificationPushResult>;
} = {}) {
  const repository: NotificationRepositoryPort = {
    save: jest.fn(
      options.save ?? (() => Promise.resolve({ id: NOTIFICATION_ID, created: true })),
    ),
    existsByDedupKey: jest.fn(async () => options.existsByDedupKey ?? false),
    markRead: jest.fn(async () => true),
  };
  const query: NotificationQueryPort = {
    findBeachName: jest.fn(async () => '협재해수욕장'),
  } as unknown as NotificationQueryPort;
  const templates: TemplateQueryPort = {
    findByCode: jest.fn(async () => null),
    findMatch: jest.fn(async () => null),
  } as unknown as TemplateQueryPort;
  const push: DispatchNotificationPushUseCase = {
    dispatch: jest.fn(options.dispatch ?? (() => Promise.resolve(NO_PUSH))),
  };

  // 문자 채널은 여기서 검증 대상이 아니다(별도 스펙). 호출만 받아 "보내지 않음" 으로 답한다.
  const sms: DispatchNotificationSmsUseCase = {
    dispatch: jest.fn(() => Promise.resolve({ skipped: true, sent: false, reason: null })),
  };

  const service = new CreateNotificationService(repository, query, templates, push, sms);
  jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

  return { service, repository, push, sms };
}

function command(overrides: Partial<CreateNotificationCommand> = {}): CreateNotificationCommand {
  return {
    targetType: 'public',
    targetUserId: null,
    targetUserToken: 'guest-abc',
    beachId: 7,
    riskLevel: 'danger',
    eventType: 'level_up',
    now: new Date('2026-07-14T09:00:00Z'),
    ...overrides,
  };
}

describe('CreateNotificationService (SYS-005 알림 생성 + 실제 발송 연동)', () => {
  it('알림을 생성하면 그 수신자에게 푸시를 발송한다', async () => {
    const { service, push } = setup();

    const res = await service.create(command());

    expect(res).toMatchObject({ notificationId: NOTIFICATION_ID, created: true });
    expect(push.dispatch).toHaveBeenCalledTimes(1);
    expect((push.dispatch as jest.Mock).mock.calls[0][0]).toMatchObject({
      notificationId: NOTIFICATION_ID,
      owner: { userId: null, userToken: 'guest-abc' },
      beachId: 7,
      riskLevel: 'danger',
      eventType: 'level_up',
    });
  });

  // ── 이 파일의 핵심 ─────────────────────────────────────────────────────────────
  it('발송이 실패해도 알림 생성을 롤백하지 않는다 (알림은 DB 에 남고 발송만 실패)', async () => {
    // 푸시 서비스 장애로 발송 유스케이스가 통째로 터지는 상황.
    const { service, repository } = setup({
      dispatch: () => Promise.reject(new Error('푸시 서비스 장애')),
    });

    const res = await service.create(command());

    // 알림은 저장됐고 created=true 다. 예외가 새어 나가면 위험도 산출 배치까지 실패한다.
    expect(res).toMatchObject({ notificationId: NOTIFICATION_ID, created: true });
    expect(repository.save).toHaveBeenCalledTimes(1);
    // 사용자는 인앱 알림함(GET /public/alerts)으로 이 알림을 여전히 읽을 수 있다.
  });

  it('발송이 실패로 끝나도(예외 없이) 알림 생성 결과는 성공이다', async () => {
    const { service } = setup({
      dispatch: () =>
        Promise.resolve({ skipped: false, attempted: 2, sent: 0, failed: 2, expired: 0 }),
    });

    const res = await service.create(command());

    expect(res).toMatchObject({ notificationId: NOTIFICATION_ID, created: true });
  });

  it('VAPID 미설정이면 발송은 건너뛰지만 알림은 정상 생성된다', async () => {
    const { service, push } = setup({ dispatch: () => Promise.resolve(NO_PUSH) });

    const res = await service.create(command());

    expect(res.created).toBe(true);
    expect(push.dispatch).toHaveBeenCalled(); // 호출은 하되 내부에서 건너뛴다.
  });

  // ── NOTI-003 중복 방지가 발송에도 적용된다 ────────────────────────────────────
  it('dedup 으로 스킵된 알림은 푸시를 보내지 않는다 (같은 경보로 두 번 울리지 않는다)', async () => {
    const { service, push } = setup({ existsByDedupKey: true });

    const res = await service.create(command());

    expect(res.created).toBe(false);
    expect(push.dispatch).not.toHaveBeenCalled();
  });

  it('동시성으로 UNIQUE 충돌해 저장이 스킵된 경우에도 푸시를 보내지 않는다', async () => {
    // save 가 P2002 를 삼키고 created=false 로 돌려준 상황.
    const { service, push } = setup({
      save: () => Promise.resolve({ id: null, created: false }),
    });

    const res = await service.create(command());

    expect(res.created).toBe(false);
    expect(push.dispatch).not.toHaveBeenCalled();
  });

  it('DB 저장 실패는 그대로 던진다 (발송 실패와 달리 알림 생성 실패는 숨기면 안 된다)', async () => {
    const { service, push } = setup({
      save: () => Promise.reject(new Error('DB 커넥션 오류')),
    });

    await expect(service.create(command())).rejects.toThrow('DB 커넥션 오류');
    expect(push.dispatch).not.toHaveBeenCalled();
  });
});
