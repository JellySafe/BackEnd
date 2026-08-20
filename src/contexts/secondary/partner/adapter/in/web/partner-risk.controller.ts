import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { RiskLevel } from '@shared/kernel/risk-level';
import {
  GetBeachRiskDetailUseCase,
  GET_BEACH_RISK_DETAIL_USE_CASE,
  ListLatestRisksUseCase,
  LIST_LATEST_RISKS_USE_CASE,
} from '@contexts/risk/application/port/in/risk-use-cases';
import { PartnerAuthGuard, RequireScope } from './partner-auth.guard';
import { PartnerCallLogInterceptor } from './partner-call-log.interceptor';
import {
  PartnerBeachRiskDetailResponse,
  PartnerBeachRiskResponse,
} from './dto/partner-risk.response';
import { SecondaryEnabledGuard } from '../../../../secondary-enabled.guard';

/**
 * 제휴사용 위험도 API (EX-001).
 *
 * ── 별도 경로·별도 스펙인 이유 ───────────────────────────────────────────────────────
 * 숙박·레저 플랫폼이 자기 화면에 "오늘 이 해변 상태" 를 띄우려면 우리 데이터가 필요하다.
 * 그렇다고 `/public/*` 을 그대로 열면 두 가지가 무너진다:
 *   1) 우리 앱 화면 사정으로 응답을 바꿀 때마다 **남의 서비스가 깨진다.**
 *   2) 누가 얼마나 쓰는지 알 수 없어 계약·과금·차단의 단위가 없다.
 * 그래서 경로를 `/partner/v1/*` 로 분리하고, 키 인증 + 범위 + 키별 호출 제한 + 호출 로그를 건다.
 *
 * ── 인증 ─────────────────────────────────────────────────────────────────────────────
 * `x-api-key: jsp_...` 헤더. 키는 관리자가 발급한다(`POST /admin/partners/:id/api-keys`).
 */
@ApiTags('secondary-partner')
@ApiHeader({
  name: 'x-api-key',
  required: true,
  description: '제휴사 API 키. 발급 시 한 번만 보여주는 값이다.',
})
@Controller('partner/v1')
// 가드는 **적힌 순서대로** 돈다. 2차 기능이 꺼져 있으면 키를 보기도 전에 404 여야 한다 —
// 꺼진 기능이 자격증명 검사 결과(401 과 404 의 차이)만으로 존재를 드러내면 안 되기 때문이다.
// (@UseGuards 를 두 번 쓰면 배열이 합쳐지되 아래쪽이 먼저 도므로, 한 줄에 순서대로 적는다)
@UseGuards(SecondaryEnabledGuard, PartnerAuthGuard)
@UseInterceptors(PartnerCallLogInterceptor)
export class PartnerRiskController {
  constructor(
    @Inject(LIST_LATEST_RISKS_USE_CASE) private readonly listLatest: ListLatestRisksUseCase,
    @Inject(GET_BEACH_RISK_DETAIL_USE_CASE) private readonly detail: GetBeachRiskDetailUseCase,
  ) {}

  @ApiOperation({
    summary: '[제휴] 해변별 현재 위험도 목록',
    description: [
      '제주 지정 해수욕장의 **현재(now) 위험도**를 한 번에 준다. 목록 화면·지도에 그대로 쓸 수 있다.',
      '',
      '- 갱신 주기는 **30분**이다. 그보다 자주 호출해도 같은 값이 나오므로 캐시를 권한다.',
      '- `dataConfidence` 가 `low` 인 값은 관측 결측이 있다는 뜻이다. 단정적으로 표시하지 말 것.',
      '- 필요한 범위: `risk:read`',
    ].join('\n'),
  })
  @ApiQuery({ name: 'region', required: false, example: '제주시', description: '시군구 필터' })
  @ApiQuery({
    name: 'level',
    required: false,
    enum: ['safe', 'caution', 'danger', 'severe'],
    description: '위험 단계 필터',
  })
  @ApiOkDataArray(PartnerBeachRiskResponse)
  @RequireScope('risk:read')
  @Get('beaches')
  async beaches(
    @Query('region') region?: string,
    @Query('level') level?: RiskLevel,
  ): Promise<PartnerBeachRiskResponse[]> {
    const rows = await this.listLatest.list({ region, level, horizon: 'now' });
    return rows.map((row) => ({
      beachId: row.beachId,
      beachName: row.name,
      region: row.region,
      lat: row.lat,
      lng: row.lng,
      riskLevel: row.riskLevel,
      riskScore: row.riskScore,
      dataConfidence: row.confidence,
      generatedAt: row.generatedAt.toISOString(),
    }));
  }

  @ApiOperation({
    summary: '[제휴] 해변 위험도 상세 (요인 + 안내 문구)',
    description: [
      '해변 하나의 현재 위험도와 **그 단계가 나온 이유**, 그리고 그대로 노출해도 되는 안내 문구를 준다.',
      '',
      '`guideText` 는 우리가 검수한 문구다. 직접 문구를 만들어 붙이면 표현이 어긋날 수 있으므로,',
      '가능하면 이 값을 그대로 쓰는 편이 안전하다.',
      '',
      '필요한 범위: `risk:read`',
    ].join('\n'),
  })
  @ApiParam({ name: 'beachId', example: 12 })
  @ApiOkData(PartnerBeachRiskDetailResponse)
  @RequireScope('risk:read')
  @Get('beaches/:beachId/risk')
  async beachRisk(
    @Param('beachId', ParseIntPipe) beachId: number,
  ): Promise<PartnerBeachRiskDetailResponse> {
    const view = await this.detail.getPublicView(beachId);
    // 목록과 상세가 같은 필드를 다른 이름으로 주면 받는 쪽이 매번 분기해야 한다. 형태를 맞춘다.
    const row = (await this.listLatest.list({ horizon: 'now' })).find(
      (r) => r.beachId === beachId,
    );

    return {
      beachId: view.beachId,
      beachName: view.beachName,
      region: row?.region ?? '',
      lat: row?.lat ?? 0,
      lng: row?.lng ?? 0,
      riskLevel: view.riskLevel,
      riskScore: view.riskScore,
      dataConfidence: view.dataConfidence,
      generatedAt: (view.generatedAt ?? new Date(0)).toISOString(),
      factors: view.factors.map((f) => ({ code: f.code, label: f.name })),
      guideText: view.guideText,
    };
  }
}
