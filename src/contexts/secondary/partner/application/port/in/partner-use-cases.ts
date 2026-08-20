import { Id } from '@shared/kernel/id';
import { PartnerStatus } from '../../../domain/partner';
import { PartnerScope } from '../../../domain/partner-api-key';
import { ApiKeySummary, RecordCallInput } from '../out/partner-api-key-repository.port';

export type { ApiKeySummary };

/** [2차] 파트너 등록 커맨드 (EX-001). */
export interface RegisterPartnerCommand {
  partnerCode: string;
  name: string;
  businessNo?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  planCode?: string | null;
}

export interface PartnerView {
  partnerId: Id;
  partnerCode: string;
  name: string;
  partnerStatus: PartnerStatus;
}

export interface RegisterPartnerUseCase {
  register(command: RegisterPartnerCommand): Promise<PartnerView>;
}
export const REGISTER_PARTNER_USE_CASE = Symbol('REGISTER_PARTNER_USE_CASE');

export interface ListPartnersUseCase {
  list(limit: number, offset: number): Promise<PartnerView[]>;
}
export const LIST_PARTNERS_USE_CASE = Symbol('LIST_PARTNERS_USE_CASE');

// ===== EX-001 API 키 발급/폐기/조회 =====
export interface IssueApiKeyCommand {
  partnerId: Id;
  scopes: PartnerScope[];
  /** 분당 호출 상한. 미지정이면 기본값을 적용한다. */
  rateLimitPerMin?: number | null;
  /** 만료일. 미지정이면 무기한(폐기하기 전까지 유효). */
  expiresAt?: Date | null;
}

export interface IssueApiKeyResult {
  apiKeyId: Id;
  keyPrefix: string;
  /**
   * **이 응답에서만 볼 수 있는 값.** 서버는 해시만 저장하므로 다시 조회할 수 없다.
   * 잃어버리면 새 키를 발급하고 기존 키를 폐기해야 한다.
   */
  apiKey: string;
  scopes: PartnerScope[];
  rateLimitPerMin: number | null;
  expiresAt: Date | null;
}

export interface IssueApiKeyUseCase {
  issue(command: IssueApiKeyCommand): Promise<IssueApiKeyResult>;
}
export const ISSUE_API_KEY_USE_CASE = Symbol('ISSUE_API_KEY_USE_CASE');

export interface ManageApiKeyUseCase {
  list(partnerId: Id): Promise<ApiKeySummary[]>;
  revoke(apiKeyId: Id): Promise<{ revoked: boolean }>;
}
export const MANAGE_API_KEY_USE_CASE = Symbol('MANAGE_API_KEY_USE_CASE');

// ===== EX-001 제휴 API 인증 (가드가 호출) =====
/** 인증에 성공한 제휴사 요청의 신원. 컨트롤러·로그가 이 값을 쓴다. */
export interface AuthenticatedPartner {
  partnerId: Id;
  apiKeyId: Id;
  keyPrefix: string;
  scopes: PartnerScope[];
  rateLimitPerMin: number | null;
}

export interface AuthenticatePartnerUseCase {
  /** 제시된 키를 검증한다. 유효하지 않으면 DomainError(401/403)를 던진다. */
  authenticate(apiKey: string, requiredScope: PartnerScope): Promise<AuthenticatedPartner>;
}
export const AUTHENTICATE_PARTNER_USE_CASE = Symbol('AUTHENTICATE_PARTNER_USE_CASE');

/** 호출 로그 기록(인터셉터가 호출). 실패해도 응답에 영향을 주지 않는다. */
export interface RecordPartnerCallUseCase {
  record(input: RecordCallInput): Promise<void>;
}
export const RECORD_PARTNER_CALL_USE_CASE = Symbol('RECORD_PARTNER_CALL_USE_CASE');
