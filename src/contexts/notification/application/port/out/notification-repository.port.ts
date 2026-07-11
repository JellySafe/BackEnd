import { Id } from '@shared/kernel/id';
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
   */
  save(notification: NotificationValue): Promise<SaveResult>;

  /** NOTI-003 중복 방지 사전 확인: 동일 dedupKey 알림 존재 여부. */
  existsByDedupKey(dedupKey: string): Promise<boolean>;

  /** 알림함 열람 처리(readAt 갱신). 대상 알림이 있으면 true. */
  markRead(id: Id, now: Date): Promise<boolean>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
