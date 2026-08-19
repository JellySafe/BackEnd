import { Id } from '@shared/kernel/id';
import { PublicOwner } from '@shared/kernel/public-owner';
import { NotificationValue } from '../../../domain/notification';

/** save 결과. dedupKey 충돌로 스킵되면 created=false, id=null. */
export interface SaveResult {
  id: Id | null;
  created: boolean;
}

/**
 * 알림 영속성 아웃바운드 포트. (Prisma 어댑터가 구현)
 * 쓰기·단순 조회를 담당한다.
 */
export interface NotificationRepositoryPort {
  /**
   * 신규 알림 저장. dedupKey UNIQUE 충돌은 조용히 무시하고 created=false 로 반환한다(멱등).
   * NotificationValue.title(string | null)도 함께 저장한다(제목 없는 알림은 null).
   */
  save(notification: NotificationValue): Promise<SaveResult>;

  /** NOTI-003 중복 방지 사전 확인: 동일 dedupKey 알림 존재 여부. */
  existsByDedupKey(dedupKey: string): Promise<boolean>;

  /**
   * 알림함 열람 처리(readAt 갱신). **소유자 조건까지 만족하는 알림이 있을 때만** true.
   *
   * 소유자를 WHERE 에 함께 넣는 이유: 예전에는 알림 id 만으로 갱신해서, 남의 알림 id 를
   * 넣으면(순차 BIGINT 라 열거가 쉽다) 그 사람의 알림이 읽음 처리됐다. 뱃지가 임의로
   * 지워지면 사용자는 위험 알림이 온 줄 모르고 지나간다.
   *
   * "조회 후 소유자 비교" 가 아니라 UPDATE 의 WHERE 로 거는 이유는 그 사이에 경합이
   * 끼어들 여지를 없애고, 남의 알림 존재 여부조차 응답으로 흘리지 않기 위해서다
   * (없는 알림과 남의 알림이 똑같이 404 가 된다).
   */
  markRead(id: Id, owner: PublicOwner, now: Date): Promise<boolean>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
