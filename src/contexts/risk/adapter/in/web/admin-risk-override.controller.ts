import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import {
  CreateRiskOverrideUseCase,
  CREATE_RISK_OVERRIDE_USE_CASE,
  ListRiskOverridesUseCase,
  LIST_RISK_OVERRIDES_USE_CASE,
  ReleaseRiskOverrideUseCase,
  RELEASE_RISK_OVERRIDE_USE_CASE,
} from '../../../application/port/in/risk-use-cases';
import { MAX_OVERRIDE_HOURS } from '../../../domain/risk-override';
import { CreateRiskOverrideRequest } from './dto/create-risk-override.request';
import {
  RiskOverrideListItemResponse,
  RiskOverrideResponse,
} from './dto/risk-override.response';

/** 기간을 안 주면 쓰는 값. 한 번의 현장 판단이 유효할 만한 길이. */
const DEFAULT_DURATION_HOURS = 6;

/**
 * 운영자 수동 등급 상향 API.
 *
 * ── 이 컨트롤러가 하는 일 ────────────────────────────────────────────────────────────
 * 룰 엔진이 낸 위험 단계를 **사람이 올린다.** 관측이 끊긴 해변(12곳 중 5곳), 룰이 아직 모르는
 * 상황(대량 표착, 현장 육안 확인)에서 시스템과 현실의 간극을 메우는 유일한 수단이다.
 *
 * ── 내리는 API 는 없다 ───────────────────────────────────────────────────────────────
 * 일부러 만들지 않았다. 두 실수의 비용이 다르기 때문이다 — 잘못 올리면 헛걱정으로 끝나지만,
 * 잘못 내리면 **사람이 물에 들어간다.** `DELETE` 는 상향을 되돌리는 것이지 단계를 낮추는 것이
 * 아니다(해제하면 엔진 산출값으로 돌아간다).
 */
@ApiTags('risk')
@ApiBearerAuth('bearer')
@Roles('operator', 'admin')
@Controller('admin/risk-overrides')
export class AdminRiskOverrideController {
  constructor(
    @Inject(CREATE_RISK_OVERRIDE_USE_CASE) private readonly createOverride: CreateRiskOverrideUseCase,
    @Inject(RELEASE_RISK_OVERRIDE_USE_CASE)
    private readonly releaseOverride: ReleaseRiskOverrideUseCase,
    @Inject(LIST_RISK_OVERRIDES_USE_CASE) private readonly listOverrides: ListRiskOverridesUseCase,
  ) {}

  @ApiOperation({
    summary: '[관리자] 위험 단계 수동 상향 — ⚠️ 시민 화면이 즉시 바뀐다',
    description: [
      '해변의 위험 단계를 **올린다.** 산출 결과가 지정한 단계보다 낮으면 여기까지 끌어올린다.',
      '',
      '**언제 쓰나**',
      '- 현장이 육안으로 위험을 확인했는데 시스템은 낮게 보고 있을 때',
      '- 관측 데이터가 끊겨 산출이 근거를 못 가질 때',
      '- 룰이 아직 다루지 못하는 상황(대량 표착 등)',
      '',
      '**바로 반영된다.** 저장 직후 그 해변을 다시 산출하므로 다음 배치(최대 30분)를 기다리지',
      '않는다. 응답의 `currentLevel` 로 실제로 올라갔는지 확인할 수 있다.',
      '',
      '**올리기만 한다.** `safe` 는 받지 않는다 — 단계를 내리는 조작은 제공하지 않는다.',
      '잘못 올리면 헛걱정으로 끝나지만 잘못 내리면 사람이 물에 들어가기 때문이다.',
      '산출이 이미 더 높으면 아무 일도 일어나지 않는다(높은 쪽이 남는다).',
      '',
      `**기한이 필수다.** 최대 ${MAX_OVERRIDE_HOURS}시간이고 기본 ${DEFAULT_DURATION_HOURS}시간이다.`,
      '기한 없는 상향은 아무도 기억하지 않는 영구 상태가 된다 — 한 달 뒤에도 "위험" 인 해변을',
      '보고 아무도 이유를 모르는 상황이 이 기능의 가장 흔한 실패다. 더 필요하면 다시 올린다.',
      '',
      '**사유가 필수다.** 없으면 나중에 해제할지 판단할 수 없다. 누가·언제·왜 올렸는지는',
      '감사 로그에도 남는다.',
      '',
      '예보 지평(24h/72h)에는 **그 시각에 아직 유효한 상향만** 반영된다 — 6시간 뒤 만료되는',
      '상향을 72시간 예보에 얹으면 그 예보가 거짓이 되기 때문이다.',
    ].join('\n'),
  })
  @ApiOkData(RiskOverrideResponse)
  @Post()
  create(@Body() body: CreateRiskOverrideRequest, @CurrentUser() user: AuthUser) {
    return this.createOverride.create({
      beachId: body.beachId,
      minRiskLevel: body.minRiskLevel,
      reason: body.reason,
      durationHours: body.durationHours ?? DEFAULT_DURATION_HOURS,
      createdBy: user.userId,
    });
  }

  @ApiOperation({
    summary: '[관리자] 상향 목록 — 지금 무엇이 걸려 있나',
    description: [
      '수동 상향 기록을 최근순으로 준다. 기본은 **지금 유효한 것만**이다.',
      '',
      '`activeOnly=false` 를 주면 해제·만료된 것까지 본다 — "그때 왜 올렸었나" 를 되짚을 때 쓴다.',
      '`beachId` 로 해변을 좁힐 수 있다.',
    ].join('\n'),
  })
  @ApiQuery({ name: 'beachId', required: false, example: 3, description: '해변으로 좁히기' })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    example: true,
    description: '기본 true(지금 유효한 것만). false 면 해제·만료분까지 본다',
  })
  @ApiOkDataArray(RiskOverrideListItemResponse)
  @Get()
  list(
    @Query('beachId') beachId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.listOverrides.list({
      beachId: parseBeachId(beachId),
      // 문자열 'false' 만 거짓으로 본다. 파라미터가 없거나 이상한 값이면 **좁은 쪽**(유효한 것만)이
      // 기본이다 — 목록이 과거 기록으로 덮여 지금 걸린 상향을 놓치는 것이 더 나쁘다.
      activeOnly: activeOnly !== 'false',
    });
  }

  @ApiOperation({
    summary: '[관리자] 상향 해제 — 엔진 산출값으로 되돌린다',
    description: [
      '만료를 기다리지 않고 상향을 내린다. **단계를 낮추는 것이 아니라** 사람이 얹었던 보장을',
      '거두는 것이다 — 해제 후에는 엔진이 산출한 값이 그대로 보인다.',
      '',
      '해제 직후 그 해변을 다시 산출하므로 화면에 바로 반영된다. 위험이 지나갔는데 다음 배치까지',
      '"위험" 이 남아 있으면 그것대로 신뢰를 잃기 때문이다.',
      '',
      '이미 해제된 기록을 다시 해제해도 200 이다(원하는 상태는 이미 이뤄져 있다).',
    ].join('\n'),
  })
  @ApiParam({ name: 'id', example: 12, description: '상향 기록 id' })
  @ApiOkData(RiskOverrideResponse)
  @Delete(':id')
  release(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.releaseOverride.release(id, user.userId);
  }
}

/** 쿼리의 beachId. 숫자가 아니면 필터를 걸지 않는다(전체 조회). */
function parseBeachId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
