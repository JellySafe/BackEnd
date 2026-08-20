import { Id } from '@shared/kernel/id';
import { PushConsentOwner } from './push-consent-repository.port';

/** 살아있는 SMS 수신 동의 1건 (notification_consents 의 channel='sms' 행). */
export interface SmsConsentRecord {
  consentId: Id;
  /** 저장 형태(01012345678). 발송 직전에만 쓰고, 응답·로그에는 마스킹해서 넣는다. */
  phoneNumber: string;
}

export interface UpsertSmsConsentInput {
  owner: PushConsentOwner;
  /** 정규화된 번호. 정규화는 도메인(phone-number.ts)이 한다. */
  phoneNumber: string;
  now: Date;
}

/**
 * SMS 수신 동의(notification_consents, channel='sms') 아웃바운드 포트.
 *
 * 푸시와 같은 테이블을 채널로 나눠 쓴다. 별도 포트로 둔 이유는 다루는 값이 다르기 때문이다 —
 * 푸시는 브라우저 구독 객체, SMS 는 전화번호이고, **전화번호는 그 자체가 개인정보**라
 * 조회·기록 경로에서 다르게 취급해야 한다.
 */
export interface SmsConsentRepositoryPort {
  /**
   * 동의 등록/변경. 같은 소유자의 SMS 행이 있으면 번호를 갱신하고 되살린다.
   * 한 사람이 여러 번호를 등록하는 경우는 받지 않는다 — 안전 알림은 한 사람에게 한 번 가면 된다.
   */
  upsert(input: UpsertSmsConsentInput): Promise<{ consentId: Id; created: boolean }>;

  /** 수신 거부. revoked_at 을 찍고 agreed=false 로 내린다. 해제된 행 수를 돌려준다. */
  revoke(owner: PushConsentOwner, now: Date): Promise<number>;

  /** 발송 대상 조회(동의했고 해제되지 않은 행). 없으면 null. */
  findActive(owner: PushConsentOwner): Promise<SmsConsentRecord | null>;
}

export const SMS_CONSENT_REPOSITORY = Symbol('SMS_CONSENT_REPOSITORY');
