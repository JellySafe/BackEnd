import { Inject, Injectable } from '@nestjs/common';
import { ListPartnersUseCase, PartnerView } from '../port/in/partner-use-cases';
import { PartnerRepositoryPort, PARTNER_REPOSITORY } from '../port/out/partner-repository.port';

/** [2차] 파트너 목록 (EX-001). 골격 유스케이스. */
@Injectable()
export class ListPartnersService implements ListPartnersUseCase {
  constructor(@Inject(PARTNER_REPOSITORY) private readonly repository: PartnerRepositoryPort) {}

  async list(limit: number, offset: number): Promise<PartnerView[]> {
    const partners = await this.repository.list(limit, offset);
    return partners.map((p) => {
      const s = p.snapshot();
      return {
        partnerId: p.id!,
        partnerCode: s.partnerCode,
        name: s.name,
        partnerStatus: s.partnerStatus,
      };
    });
  }
}
