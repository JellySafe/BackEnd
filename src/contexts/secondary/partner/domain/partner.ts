import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';

/** 파트너 상태 (partners.partner_status). */
export const PARTNER_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export interface PartnerProps {
  id?: Id;
  partnerCode: string;
  name: string;
  businessNo: string | null;
  contactName: string | null;
  contactEmail: string | null;
  planCode: string | null;
  partnerStatus: PartnerStatus;
  createdAt?: Date;
}

export interface RegisterPartnerInput {
  partnerCode: string;
  name: string;
  businessNo?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  planCode?: string | null;
}

/**
 * [2차] 파트너 애그리거트 (EX-001 외부 연동 API). 골격 — 최소 불변식만.
 */
export class Partner {
  private constructor(private props: PartnerProps) {}

  static register(input: RegisterPartnerInput): Partner {
    if (!input.partnerCode?.trim()) {
      throw new ValidationError('PARTNER_CODE_REQUIRED', '파트너 코드가 필요합니다.');
    }
    if (!input.name?.trim()) {
      throw new ValidationError('PARTNER_NAME_REQUIRED', '파트너명이 필요합니다.');
    }
    return new Partner({
      partnerCode: input.partnerCode.trim(),
      name: input.name.trim(),
      businessNo: input.businessNo ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      planCode: input.planCode ?? null,
      partnerStatus: 'active',
    });
  }

  static reconstitute(props: PartnerProps): Partner {
    return new Partner(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }

  snapshot(): Readonly<PartnerProps> {
    return { ...this.props };
  }
}
