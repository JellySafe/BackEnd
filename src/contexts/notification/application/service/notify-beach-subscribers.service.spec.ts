import { GetBeachSubscribersUseCase } from '@contexts/favorite/application/port/in/favorite-use-cases';
import { BeachSubscriber } from '@contexts/favorite/application/port/out/favorite-query.port';
import {
  CreateNotificationCommand,
  CreateNotificationResult,
  CreateNotificationUseCase,
} from '../port/in/notification-use-cases';
import { NotifyBeachSubscribersService } from './notify-beach-subscribers.service';

function subscriber(userId: number, token = `tok-${userId}`): BeachSubscriber {
  return { userId, userToken: token };
}

/** created 여부만 지정하는 CreateNotification 결과 스텁. */
function result(created: boolean): CreateNotificationResult {
  return {
    notificationId: created ? 1 : null,
    created,
    dedupKey: 'dedup-key',
    message: '테스트 알림 문구',
  };
}

describe('NotifyBeachSubscribersService (SYS-005 관심 해변 알림 확산)', () => {
  const BEACH_ID = 100;

  function setup(
    subscribers: BeachSubscriber[],
    createImpl: (command: CreateNotificationCommand) => Promise<CreateNotificationResult>,
    areaSubscribers: { userId: number; areaLabel: string | null }[] = [],
  ) {
    const getSubscribers = jest.fn<Promise<BeachSubscriber[]>, [number]>().mockResolvedValue(
      subscribers,
    );
    const create = jest.fn(createImpl);
    const subscribersUseCase: GetBeachSubscribersUseCase = { getSubscribers };
    const createUseCase: CreateNotificationUseCase = { create };
    const findByBeach = jest.fn().mockResolvedValue(areaSubscribers);
    const service = new NotifyBeachSubscribersService(subscribersUseCase, createUseCase, {
      findByBeach,
    });
    // 로그 소음 억제 (부분 실패 warn).
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    return { service, getSubscribers, create, findByBeach };
  }

  it('모든 관심 등록자에게 public 알림을 생성하고 생성 수를 집계한다', async () => {
    const subs = [subscriber(1), subscriber(2), subscriber(3)];
    const { service, create } = setup(subs, () => Promise.resolve(result(true)));

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res).toEqual({ subscriberCount: 3, createdCount: 3 });
    expect(create).toHaveBeenCalledTimes(3);
    // 대상은 항상 public, 각 구독자 식별자가 전달된다.
    for (const call of create.mock.calls) {
      expect(call[0]).toMatchObject({ targetType: 'public', beachId: BEACH_ID });
    }
    expect(create.mock.calls.map((c) => c[0].targetUserId)).toEqual([1, 2, 3]);
  });

  it('멱등성: dedup 으로 created=false 인 건은 createdCount 에서 제외한다', async () => {
    const subs = [subscriber(1), subscriber(2), subscriber(3), subscriber(4)];
    // userId 가 짝수면 이미 알림이 존재(dedup) → created=false.
    const { service } = setup(subs, (command) =>
      Promise.resolve(result((command.targetUserId as number) % 2 === 1)),
    );

    const res = await service.notifySubscribers({
      beachId: BEACH_ID,
      eventType: 'level_up',
      riskLevel: 'danger',
    });

    // 조회된 구독자는 4명 전원, 실제 신규 생성은 홀수 id 2명.
    expect(res).toEqual({ subscriberCount: 4, createdCount: 2 });
  });

  it('부분 실패: 한 구독자 생성이 실패해도 나머지는 계속 처리하고 예외를 던지지 않는다', async () => {
    const subs = [subscriber(1), subscriber(2), subscriber(3)];
    const { service, create } = setup(subs, (command) => {
      if (command.targetUserId === 2) {
        return Promise.reject(new Error('DB 커넥션 오류'));
      }
      return Promise.resolve(result(true));
    });

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'sting_report' });

    // 실패 1건은 삼켜지고 createdCount 에서 빠진다. 전체 확산은 중단되지 않는다.
    expect(res).toEqual({ subscriberCount: 3, createdCount: 2 });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('구독자가 없으면 알림을 생성하지 않는다', async () => {
    const { service, create } = setup([], () => Promise.resolve(result(true)));

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res).toEqual({ subscriberCount: 0, createdCount: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it('구독자 수가 동시 처리 한계를 넘어도 전원에게 정확히 1회씩 생성한다(제한 병렬)', async () => {
    // FAN_OUT_CONCURRENCY(8) 를 넘는 20명 → 청크 경계에서 누락/중복이 없어야 한다.
    const subs = Array.from({ length: 20 }, (_, i) => subscriber(i + 1));
    const { service, create } = setup(subs, () => Promise.resolve(result(true)));

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res).toEqual({ subscriberCount: 20, createdCount: 20 });
    expect(create).toHaveBeenCalledTimes(20);
    const ids = create.mock.calls.map((c) => c[0].targetUserId).sort((a, b) => Number(a) - Number(b));
    expect(ids).toEqual(subs.map((s) => s.userId));
  });

  // --- 해역 구독자 확산 (EX-004) -----------------------------------------------------

  it('그 해변을 감시 구역에 둔 유료 구독자에게도 알림이 간다', async () => {
    const { service, create } = setup([subscriber(1)], () => Promise.resolve(result(true)), [
      { userId: 50, areaLabel: '한림 양식장 앞' },
    ]);

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res.subscriberCount).toBe(2);
    expect(create.mock.calls.map((c) => c[0].targetUserId)).toEqual([1, 50]);
  });

  it('관심 해변과 해역 구독 양쪽에 걸린 사람에게는 한 번만 보낸다', async () => {
    const { service, create } = setup([subscriber(7)], () => Promise.resolve(result(true)), [
      { userId: 7, areaLabel: null },
    ]);

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res.subscriberCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('해역 구독자 조회가 실패해도 관심 해변 알림은 그대로 나간다', async () => {
    const { service, create, findByBeach } = setup([subscriber(1)], () =>
      Promise.resolve(result(true)),
    );
    findByBeach.mockRejectedValue(new Error('DB 연결 끊김'));

    const res = await service.notifySubscribers({ beachId: BEACH_ID, eventType: 'level_up' });

    expect(res.createdCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
