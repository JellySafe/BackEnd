import { Id } from '@shared/kernel/id';
import { PartnerScope, StoredApiKey } from '../../../domain/partner-api-key';

/** 발급된 키의 메타데이터(원문·해시 제외). 관리자 목록에 그대로 나간다. */
export interface ApiKeySummary {
  apiKeyId: Id;
  partnerId: Id;
  keyPrefix: string;
  scopes: PartnerScope[];
  rateLimitPerMin: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface SaveApiKeyInput {
  partnerId: Id;
  keyPrefix: string;
  apiKeyHash: string;
  scopes: PartnerScope[];
  rateLimitPerMin: number | null;
  expiresAt: Date | null;
}

/** 호출 1건 기록(과금·감사). */
export interface RecordCallInput {
  partnerId: Id;
  apiKeyId: Id | null;
  endpoint: string;
  httpMethod: string;
  statusCode: number;
  responseTimeMs: number;
  /** 과금 대상인지. 인증 실패(401/403)와 서버 오류(5xx)는 제휴사 잘못이 아니므로 과금하지 않는다. */
  isBillable: boolean;
  calledAt: Date;
}

/**
 * 제휴사 API 키 영속성 아웃바운드 포트 (EX-001).
 */
export interface PartnerApiKeyRepositoryPort {
  save(input: SaveApiKeyInput): Promise<ApiKeySummary>;

  /** 접두사로 검증에 필요한 값을 읽는다(제휴사 상태 포함). 없으면 null. */
  findByPrefix(keyPrefix: string): Promise<StoredApiKey | null>;

  listByPartner(partnerId: Id): Promise<ApiKeySummary[]>;

  /** 폐기. 이미 폐기된 키면 false(멱등). */
  revoke(apiKeyId: Id, now: Date): Promise<boolean>;

  /** 호출 로그 기록. **실패해도 API 응답을 막지 않는다**(호출측이 삼킨다). */
  recordCall(input: RecordCallInput): Promise<void>;
}

export const PARTNER_API_KEY_REPOSITORY = Symbol('PARTNER_API_KEY_REPOSITORY');
