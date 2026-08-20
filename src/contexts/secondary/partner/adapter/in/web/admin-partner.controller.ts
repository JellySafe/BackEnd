import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  IssueApiKeyUseCase,
  ISSUE_API_KEY_USE_CASE,
  ListPartnersUseCase,
  LIST_PARTNERS_USE_CASE,
  ManageApiKeyUseCase,
  MANAGE_API_KEY_USE_CASE,
  RegisterPartnerUseCase,
  REGISTER_PARTNER_USE_CASE,
} from '../../../application/port/in/partner-use-cases';
import { RegisterPartnerRequest } from './dto/register-partner.request';
import { RegisterPartnerResponse, ListPartnersResponse } from './dto/partner.response';
import {
  ApiKeySummaryResponse,
  IssueApiKeyRequest,
  IssueApiKeyResponse,
  RevokeApiKeyResponse,
} from './dto/api-key.dto';
import { SecondaryEnabledGuard } from '../../../../secondary-enabled.guard';

/**
 * [2차] 파트너 관리 API (EX-001 외부 연동). 골격 — 실제 인증/과금은 2차 범위.
 */
@ApiTags('secondary-partner')
@ApiBearerAuth('bearer')
@Roles('admin')
// 2차 기능이 꺼져 있으면 여기서 404 다. 인증보다 **먼저** 걸러야
// 꺼진 기능이 자격증명 검사만으로도 존재를 드러내지 않는다.
@UseGuards(SecondaryEnabledGuard)
@Controller('admin/partners')
export class AdminPartnerController {
  constructor(
    @Inject(REGISTER_PARTNER_USE_CASE) private readonly registerPartner: RegisterPartnerUseCase,
    @Inject(LIST_PARTNERS_USE_CASE) private readonly listPartners: ListPartnersUseCase,
    @Inject(ISSUE_API_KEY_USE_CASE) private readonly issueApiKey: IssueApiKeyUseCase,
    @Inject(MANAGE_API_KEY_USE_CASE) private readonly manageApiKey: ManageApiKeyUseCase,
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

  // --- API 키 (EX-001) --------------------------------------------------------------

  @ApiOperation({
    summary: '[관리자] 제휴사 API 키 발급 — 원문은 이 응답에서만 볼 수 있다',
    description: [
      '제휴사가 `/partner/v1/*` 을 호출할 때 쓸 키를 발급한다.',
      '',
      '⚠️ **응답의 `apiKey` 는 이 순간에만 볼 수 있다.** 서버는 해시만 저장하므로 다시 조회할 수',
      '없다(DB 덤프 하나로 제휴사 전부의 자격증명이 새는 것을 막기 위해서다). 잃어버리면 폐기 후',
      '재발급한다. 제휴사에 전달할 때는 안전한 경로를 쓴다.',
      '',
      '- `scopes` 는 계약 범위만 담는다. 표시가 없으면 그 기능은 막힌다.',
      '- `rateLimitPerMin` 은 키 단위 제한이다(IP 가 아니라 키가 계약·과금의 단위다).',
      '- `expiresAt` 을 넣으면 계약 종료일에 자동으로 막힌다 — 사람이 잊어도 키가 스스로 닫힌다.',
    ].join('\n'),
  })
  @ApiParam({ name: 'partnerId', example: 1 })
  @ApiOkData(IssueApiKeyResponse)
  @Post(':partnerId/api-keys')
  issue(
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Body() body: IssueApiKeyRequest,
  ) {
    return this.issueApiKey.issue({
      partnerId,
      scopes: body.scopes,
      rateLimitPerMin: body.rateLimitPerMin ?? null,
      expiresAt: body.expiresAt === undefined ? null : new Date(body.expiresAt),
    });
  }

  @ApiOperation({
    summary: '[관리자] 제휴사 API 키 목록',
    description: '발급된 키의 접두사·범위·한도·만료·폐기 상태. **키 원문은 포함되지 않는다.**',
  })
  @ApiParam({ name: 'partnerId', example: 1 })
  @ApiOkDataArray(ApiKeySummaryResponse)
  @Get(':partnerId/api-keys')
  listKeys(@Param('partnerId', ParseIntPipe) partnerId: number) {
    return this.manageApiKey.list(partnerId);
  }

  @ApiOperation({
    summary: '[관리자] 제휴사 API 키 폐기',
    description: [
      '즉시 무효화한다. 폐기된 키로 호출하면 401 이다.',
      '',
      '이미 폐기된 키를 다시 폐기해도 성공이다(`revoked: false`) — 목적은 이미 달성돼 있다.',
    ].join('\n'),
  })
  @ApiParam({ name: 'partnerId', example: 1 })
  @ApiParam({ name: 'apiKeyId', example: 3 })
  @ApiOkData(RevokeApiKeyResponse)
  @Delete(':partnerId/api-keys/:apiKeyId')
  revokeKey(@Param('apiKeyId', ParseIntPipe) apiKeyId: number) {
    return this.manageApiKey.revoke(apiKeyId);
  }
}
