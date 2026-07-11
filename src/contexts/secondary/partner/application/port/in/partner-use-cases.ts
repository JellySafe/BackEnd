import { Id } from '@shared/kernel/id';
import { PartnerStatus } from '../../../domain/partner';

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
