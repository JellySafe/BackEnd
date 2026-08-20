import { Id } from '@shared/kernel/id';
import { PublicOwner } from '@shared/kernel/public-owner';
import { ConsentType } from '../../../domain/report-enums';

/** 저장할 동의 한 건. */
export interface ConsentRecord {
  owner: PublicOwner;
  type: ConsentType;
  agreed: boolean;
  policyVersion: string;
  agreedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
}

/** 저장된 동의(제보 접수에 넘길 id 포함). */
export interface StoredConsent {
  consentLogId: Id;
  type: ConsentType;
  agreed: boolean;
}

/**
 * 동의 기록 아웃바운드 포트 (PRIV-001~003).
 */
export interface ConsentRepositoryPort {
  /** 동의 여러 건을 한 트랜잭션으로 기록한다(화면에서 한 번에 받은 항목들이라 함께 남아야 한다). */
  saveAll(records: ConsentRecord[]): Promise<StoredConsent[]>;

  /**
   * 만료된 동의 기록을 파기한다.
   *
   * **제보에 연결된 동의는 그 제보의 사진·위치가 파기된 뒤에만 지운다.** 살아있는 제보의 근거를
   * 먼저 지우면, 남은 제보를 무슨 근거로 갖고 있는지 설명할 수 없게 된다.
   *
   * @returns 지운 동의 기록 수.
   */
  purgeExpired(now: Date, batchSize: number): Promise<number>;
}

export const CONSENT_REPOSITORY = Symbol('CONSENT_REPOSITORY');
