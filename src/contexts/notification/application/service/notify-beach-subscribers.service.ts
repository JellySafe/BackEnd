import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GetBeachSubscribersUseCase,
  GET_BEACH_SUBSCRIBERS_USE_CASE,
} from '@contexts/favorite/application/port/in/favorite-use-cases';
import { BeachSubscriber } from '@contexts/favorite/application/port/out/favorite-query.port';
import {
  CreateNotificationUseCase,
  CREATE_NOTIFICATION_USE_CASE,
  NotifyBeachSubscribersCommand,
  NotifyBeachSubscribersResult,
  NotifyBeachSubscribersUseCase,
} from '../port/in/notification-use-cases';
import {
  AreaSubscriberQueryPort,
  AREA_SUBSCRIBER_QUERY,
} from '../port/out/area-subscriber-query.port';

/**
 * 관심 해변 구독자 알림 생성 시 한 번에 처리할 최대 동시 개수.
 * 순차 for-loop 는 구독자 N 에 비례해 지연이 선형 증가하고(대량 발송 시 배치 지연),
 * 무제한 병렬은 DB 커넥션 풀을 고갈시킬 수 있어 그 사이의 제한 병렬을 택한다.
 * 값은 커넥션 풀 크기보다 작게 유지한다.
 */
const FAN_OUT_CONCURRENCY = 8;

/**
 * SYS-005 관심 해변 구독자 알림 확산.
 * 해변을 관심 등록한 일반 사용자(public)에게 알림을 생성한다(USR-003 연동).
 * 개별 생성은 CreateNotification 의 dedup 멱등성으로 중복이 방지된다.
 * 구독자별 실패는 삼켜(warn 로그) 전체 확산을 막지 않는다.
 *
 * 대량 발송 성능: 구독자를 FAN_OUT_CONCURRENCY 크기 청크로 나눠 제한 병렬 처리한다.
 * 청크 내 개별 실패는 다른 구독자에게 영향을 주지 않는다.
 */
@Injectable()
export class NotifyBeachSubscribersService implements NotifyBeachSubscribersUseCase {
  private readonly logger = new Logger(NotifyBeachSubscribersService.name);

  constructor(
    @Inject(GET_BEACH_SUBSCRIBERS_USE_CASE)
    private readonly subscribers: GetBeachSubscribersUseCase,
    @Inject(CREATE_NOTIFICATION_USE_CASE)
    private readonly createNotification: CreateNotificationUseCase,
    @Inject(AREA_SUBSCRIBER_QUERY)
    private readonly areaSubscribers: AreaSubscriberQueryPort,
  ) {}

  async notifySubscribers(
    command: NotifyBeachSubscribersCommand,
  ): Promise<NotifyBeachSubscribersResult> {
    const list = await this.collectTargets(command.beachId);
    let createdCount = 0;

    // 제한 병렬: 한 번에 FAN_OUT_CONCURRENCY 건씩 처리해 지연을 줄이되 커넥션 풀 부하를 억제한다.
    for (let i = 0; i < list.length; i += FAN_OUT_CONCURRENCY) {
      const chunk = list.slice(i, i + FAN_OUT_CONCURRENCY);
      const outcomes = await Promise.all(chunk.map((sub) => this.notifyOne(command, sub)));
      createdCount += outcomes.reduce((sum, created) => sum + (created ? 1 : 0), 0);
    }

    return { subscriberCount: list.length, createdCount };
  }

  /**
   * 알림 대상을 모은다: **관심 해변 등록자 + 그 해변을 감시 구역에 둔 유료 구독자**(EX-004).
   *
   * 두 집단은 근거가 다르다 — 앞은 그 해변을 콕 집은 일반 사용자이고, 뒤는 자기 조업·양식
   * 구역이 그 해변을 포함하는 어민·양식장이다. 같은 사람이 양쪽에 있을 수 있으므로 userId 로
   * 합친다(중복 알림은 알림 피로를 키운다).
   *
   * 해역 구독자 조회가 실패해도 관심 해변 알림은 그대로 나간다. 부가 채널의 장애로 기본 알림이
   * 멎으면 안 된다.
   */
  private async collectTargets(beachId: number): Promise<BeachSubscriber[]> {
    const favorites = await this.subscribers.getSubscribers(beachId);

    let areaSubscribers: { userId: number }[] = [];
    try {
      areaSubscribers = await this.areaSubscribers.findByBeach(beachId);
    } catch (err) {
      this.logger.warn(
        `해역 구독자 조회 실패(관심 해변 알림은 계속한다, beachId=${beachId}): ${err}`,
      );
    }

    const seenUserIds = new Set(
      favorites.map((f) => f.userId).filter((id): id is number => id !== null),
    );
    const merged: BeachSubscriber[] = [...favorites];
    for (const sub of areaSubscribers) {
      if (seenUserIds.has(sub.userId)) continue;
      seenUserIds.add(sub.userId);
      merged.push({ userId: sub.userId, userToken: null });
    }
    return merged;
  }

  /** 구독자 1명에게 알림 생성. 신규 생성 시 true, 중복(dedup)/실패 시 false. 실패는 삼킨다. */
  private async notifyOne(
    command: NotifyBeachSubscribersCommand,
    sub: BeachSubscriber,
  ): Promise<boolean> {
    try {
      const res = await this.createNotification.create({
        targetType: 'public',
        targetUserId: sub.userId,
        targetUserToken: sub.userToken,
        beachId: command.beachId,
        riskLevel: command.riskLevel ?? null,
        eventType: command.eventType,
        now: command.now,
        // ADM-010 수동 발송: 관리자 문구/멱등 정책을 각 구독자에게 그대로 전파(미지정이면 기존 자동 동작).
        messageOverride: command.messageOverride,
        titleOverride: command.titleOverride,
        skipDedup: command.skipDedup,
      });
      return res.created;
    } catch (err) {
      this.logger.warn(
        `관심 해변 알림 생성 실패 (beachId=${command.beachId}, userId=${sub.userId}, token=${sub.userToken}): ${err}`,
      );
      return false;
    }
  }
}
