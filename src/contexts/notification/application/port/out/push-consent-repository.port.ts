import { Id } from '@shared/kernel/id';
import { WebPushSubscription } from '../../../domain/push-subscription';

/**
 * 알림 수신자 식별자. 비로그인은 userToken, 로그인은 userId (관심 해변과 같은 규칙).
 * 둘 다 null 이면 브로드캐스트 알림(admin/operator)이라 푸시 대상이 없다.
 */
export interface PushConsentOwner {
  userId: Id | null;
  userToken: string | null;
}

/** 살아있는 푸시 구독 1건 (notification_consents 한 행). */
export interface PushConsentRecord {
  consentId: Id;
  subscription: WebPushSubscription;
}

export interface UpsertPushConsentInput {
  owner: PushConsentOwner;
  subscription: WebPushSubscription;
  now: Date;
}

export interface UpsertPushConsentResult {
  consentId: Id;
  /** 새 구독이면 true, 기존 구독(같은 endpoint) 재동의면 false. */
  created: boolean;
}

export interface RevokePushConsentInput {
  owner: PushConsentOwner;
  /** 지정 시 해당 endpoint 구독만 해제. 미지정이면 이 사용자의 푸시 구독을 전부 해제한다. */
  endpoint: string | null;
  now: Date;
}

/**
 * 푸시 수신 동의(notification_consents) 아웃바운드 포트. (Prisma 어댑터가 구현)
 * channel='push' 행만 다룬다. sms/email 은 2차 범위다.
 */
export interface PushConsentRepositoryPort {
  /**
   * 구독 등록/재동의. 같은 소유자 + 같은 endpoint 행이 있으면 되살리고(agreed=true, revoked_at=null),
   * 없으면 새로 만든다. 버튼 연타/재구독에도 행이 무한히 늘지 않게 하는 멱등 규칙이다.
   */
  upsert(input: UpsertPushConsentInput): Promise<UpsertPushConsentResult>;

  /** 구독 해제. revoked_at 을 찍고 agreed=false 로 내린다. 해제된 행 수를 돌려준다. */
  revoke(input: RevokePushConsentInput): Promise<number>;

  /**
   * 구독 만료(410/404) 시 그 구독만 무효화한다.
   * 이걸 하지 않으면 죽은 구독에 영원히 재시도하게 된다.
   */
  revokeById(consentId: Id, now: Date): Promise<void>;

  /**
   * 발송 대상 조회: 동의했고(agreed=true) 해제되지 않은(revoked_at IS NULL)
   * 푸시 구독 목록. 구독 정보가 깨진 행은 제외한다.
   */
  findActive(owner: PushConsentOwner): Promise<PushConsentRecord[]>;
}

export const PUSH_CONSENT_REPOSITORY = Symbol('PUSH_CONSENT_REPOSITORY');
