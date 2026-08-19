import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  ListPartnersUseCase,
  LIST_PARTNERS_USE_CASE,
  RegisterPartnerUseCase,
  REGISTER_PARTNER_USE_CASE,
} from '../../../application/port/in/partner-use-cases';
import { RegisterPartnerRequest } from './dto/register-partner.request';
import { RegisterPartnerResponse, ListPartnersResponse } from './dto/partner.response';

/**
 * [2차] 파트너 관리 API (EX-001 외부 연동). 골격 — 실제 인증/과금은 2차 범위.
 */
@ApiTags('secondary-partner')
@ApiBearerAuth('bearer')
@Roles('admin')
@Controller('admin/partners')
export class AdminPartnerController {
  constructor(
    @Inject(REGISTER_PARTNER_USE_CASE) private readonly registerPartner: RegisterPartnerUseCase,
    @Inject(LIST_PARTNERS_USE_CASE) private readonly listPartners: ListPartnersUseCase,
  ) {}

  /** [2차] 파트너 등록 */
  @ApiOperation({
    summary: '[2차 확장] 파트너 등록 — MVP 에서는 사용하지 않음',
    description: [
      '외부 기관/업체를 파트너로 등록하는 골격(EX-001).',
      '',
      '⚠️ **2차 확장 골격이라 지금 붙일 필요 없다.** 실제 로직 대신 자리만 잡아둔 상태이고,',
      '응답에 `note: "[2차] ..."` 가 그대로 들어있다. MVP 화면 연동 대상이 아니다.',
    ].join('\n'),
  })
  @ApiOkData(RegisterPartnerResponse)
  @Post()
  async register(@Body() body: RegisterPartnerRequest) {
    const partner = await this.registerPartner.register(body);
    return { note: '[2차] EX-001 파트너 연동 골격', partner };
  }

  /** [2차] 파트너 목록 */
  @ApiOperation({
    summary: '[2차 확장] 파트너 목록 — MVP 에서는 사용하지 않음',
    description: [
      '등록된 파트너 목록 조회 골격(EX-001).',
      '',
      '⚠️ **2차 확장 골격이라 지금 붙일 필요 없다.** 실제 로직 대신 자리만 잡아둔 상태이고,',
      '응답에 `note: "[2차] ..."` 가 그대로 들어있다. MVP 화면 연동 대상이 아니다.',
    ].join('\n'),
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: '페이지 번호(1부터). 생략 시 1.',
  })
  @ApiQuery({
    name: 'size',
    required: false,
    type: Number,
    example: 20,
    description: '페이지당 개수. 생략 시 20, 100 을 넘겨도 100 으로 잘린다.',
  })
  @ApiOkData(ListPartnersResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const partners = await this.listPartners.list(req.size, offsetOf(req));
    return { note: '[2차] EX-001 파트너 연동 골격', partners };
  }
}
