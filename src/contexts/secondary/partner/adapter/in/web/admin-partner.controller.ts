import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  ListPartnersUseCase,
  LIST_PARTNERS_USE_CASE,
  RegisterPartnerUseCase,
  REGISTER_PARTNER_USE_CASE,
} from '../../../application/port/in/partner-use-cases';
import { RegisterPartnerRequest } from './dto/register-partner.request';

/**
 * [2차] 파트너 관리 API (EX-001 외부 연동). 골격 — 실제 인증/과금은 2차 범위.
 */
@Controller('admin/partners')
export class AdminPartnerController {
  constructor(
    @Inject(REGISTER_PARTNER_USE_CASE) private readonly registerPartner: RegisterPartnerUseCase,
    @Inject(LIST_PARTNERS_USE_CASE) private readonly listPartners: ListPartnersUseCase,
  ) {}

  /** [2차] 파트너 등록 */
  @Post()
  async register(@Body() body: RegisterPartnerRequest) {
    const partner = await this.registerPartner.register(body);
    return { note: '[2차] EX-001 파트너 연동 골격', partner };
  }

  /** [2차] 파트너 목록 */
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const partners = await this.listPartners.list(req.size, offsetOf(req));
    return { note: '[2차] EX-001 파트너 연동 골격', partners };
  }
}
