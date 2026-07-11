import { Inject, Injectable } from '@nestjs/common';
import { Partner } from '../../domain/partner';
import {
  PartnerView,
  RegisterPartnerCommand,
  RegisterPartnerUseCase,
} from '../port/in/partner-use-cases';
import { PartnerRepositoryPort, PARTNER_REPOSITORY } from '../port/out/partner-repository.port';

/** [2차] 파트너 등록 (EX-001). 골격 유스케이스. */
@Injectable()
export class RegisterPartnerService implements RegisterPartnerUseCase {
  constructor(@Inject(PARTNER_REPOSITORY) private readonly repository: PartnerRepositoryPort) {}

  async register(command: RegisterPartnerCommand): Promise<PartnerView> {
    const saved = await this.repository.save(Partner.register(command));
    const s = saved.snapshot();
    return {
      partnerId: saved.id!,
      partnerCode: s.partnerCode,
      name: s.name,
      partnerStatus: s.partnerStatus,
    };
  }
}
