import { Id } from '@shared/kernel/id';
import { Partner } from '../../../domain/partner';

/**
 * [2차] 파트너 영속성 아웃바운드 포트 (EX-001). Prisma 어댑터가 구현. save/findById/list 골격.
 */
export interface PartnerRepositoryPort {
  save(partner: Partner): Promise<Partner>;
  findById(id: Id): Promise<Partner | null>;
  list(limit: number, offset: number): Promise<Partner[]>;
}

export const PARTNER_REPOSITORY = Symbol('PARTNER_REPOSITORY');
