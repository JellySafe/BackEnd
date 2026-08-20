import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  CreateSubscriptionUseCase,
  CREATE_SUBSCRIPTION_USE_CASE,
  ListSubscriptionsUseCase,
  LIST_SUBSCRIPTIONS_USE_CASE,
  ManageSubscriptionUseCase,
  MANAGE_SUBSCRIPTION_USE_CASE,
} from '../../../application/port/in/subscription-use-cases';
import { CreateSubscriptionRequest } from './dto/create-subscription.request';
import { CreateSubscriptionResponse, ListSubscriptionsResponse } from './dto/subscription.response';
import {
  AddSubscriptionAreaRequest,
  ChangeSubscriptionStatusRequest,
  RecordPaymentRequest,
  RemoveSubscriptionAreaResponse,
  SubscriptionAreaResponse,
  SubscriptionStateResponse,
} from './dto/subscription-manage.dto';
import { SubscriptionStatus } from '../../../domain/subscription';

/**
 * [2차] 구독 관리 API (EX-002 어업/양식 구독). 골격 — 결제/과금 흐름은 2차 범위.
 */
@ApiTags('secondary-subscription')
@ApiBearerAuth('bearer')
@Roles('admin')
@Controller('admin/subscriptions')
export class AdminSubscriptionController {
  constructor(
    @Inject(CREATE_SUBSCRIPTION_USE_CASE)
    private readonly createSubscription: CreateSubscriptionUseCase,
    @Inject(LIST_SUBSCRIPTIONS_USE_CASE)
    private readonly listSubscriptions: ListSubscriptionsUseCase,
    @Inject(MANAGE_SUBSCRIPTION_USE_CASE)
    private readonly manage: ManageSubscriptionUseCase,
  ) {}

  /** [2차] 구독 생성 */
  @ApiOperation({
    summary: '[2차 확장] 구독 생성 — MVP 에서는 사용하지 않음',
    description: [
      '어업/양식 사업자 구독을 만드는 골격(EX-002).',
      '',
      '⚠️ **2차 확장 골격이라 지금 붙일 필요 없다.** 실제 로직 대신 자리만 잡아둔 상태이고,',
      '응답에 `note: "[2차] ..."` 가 그대로 들어있다. MVP 화면 연동 대상이 아니다.',
    ].join('\n'),
  })
  @ApiOkData(CreateSubscriptionResponse)
  @Post()
  async create(@Body() body: CreateSubscriptionRequest) {
    const subscription = await this.createSubscription.create({
      userId: body.userId,
      subscriberType: body.subscriberType,
      planCode: body.planCode,
      areas: (body.areas ?? []).map((a) => ({
        beachId: a.beachId ?? null,
        label: a.label ?? null,
      })),
    });
    return { note: '[2차] EX-002 구독 골격', subscription };
  }

  /** [2차] 구독 목록 */
  @ApiOperation({
    summary: '[2차 확장] 구독 목록 — MVP 에서는 사용하지 않음',
    description: [
      '구독 목록 조회 골격(EX-002).',
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
  @ApiOkData(ListSubscriptionsResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const subscriptions = await this.listSubscriptions.list(req.size, offsetOf(req));
    return { note: '[2차] EX-002 구독 골격', subscriptions };
  }

  // --- 상태 · 결제 · 감시 구역 (EX-004) ---------------------------------------------

  @ApiOperation({
    summary: '[관리자] 구독 상태 변경 — 활성/일시정지/해지',
    description: [
      '**활성(active) 구독만 해역 알림을 받는다.** 그래서 이 API 는 값을 바꾸는 일이 아니라',
      '"이 사람에게 안전 알림을 보낼 것인가" 를 정하는 일이다.',
      '',
      '- 허용 전이만 받는다(해지·만료는 종착 — 되살리려면 새 구독을 만든다).',
      '- 활성화하려면 결제가 확인돼 있어야 한다(미납이면 422).',
    ].join('\n'),
  })
  @ApiParam({ name: 'subscriptionId', example: 5 })
  @ApiOkData(SubscriptionStateResponse)
  @Patch(':subscriptionId/status')
  changeStatus(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Body() body: ChangeSubscriptionStatusRequest,
  ) {
    return this.manage.changeStatus(
      subscriptionId,
      body.status as SubscriptionStatus,
      body.expiresAt === undefined ? undefined : new Date(body.expiresAt),
    );
  }

  @ApiOperation({
    summary: '[관리자] 결제 결과 기록',
    description: [
      '결제 상태를 기록한다. `paid` 여야 구독을 활성화할 수 있고, `refunded` 로 기록하면',
      '활성·정지 구독이 **자동으로 해지**된다(돈을 돌려주고도 알림이 계속 가면 안 된다).',
      '',
      '⚠️ 결제 게이트웨이 연동은 포함돼 있지 않다 — PG 계약·정산 계정이 필요하고, 그것 없이 만든',
      '연동은 검증할 수 없다. 지금은 정산 결과를 사람이 기록하는 자리이며, PG 를 붙이면 그 결과를',
      '이 API 로 넘기면 된다(상태 규칙은 그대로 쓴다).',
    ].join('\n'),
  })
  @ApiParam({ name: 'subscriptionId', example: 5 })
  @ApiOkData(SubscriptionStateResponse)
  @Post(':subscriptionId/payments')
  recordPayment(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Body() body: RecordPaymentRequest,
  ) {
    return this.manage.recordPayment(subscriptionId, body.paymentStatus, body.amount ?? null);
  }

  @ApiOperation({
    summary: '[관리자] 감시 구역 등록 — 해변 또는 좌표+반경',
    description: [
      '어민·양식장이 신경 쓰는 해역은 **해수욕장과 일치하지 않는다.** 그래서 두 형태를 받는다:',
      '',
      '- `beachId` : 그 해변의 위험도를 그대로 받는다.',
      '- `centerLat`/`centerLng`(+ `radiusKm`) : 그 원 안에 들어오는 해변의 위험도를 받는다.',
      '',
      '좌표 구역이라고 새 위험도를 산출하지는 않는다 — 위험도는 해변 단위로만 산출되고, 바다',
      '한가운데 임의 좌표의 값은 우리가 알 수 없다. **"가까운 해변에서 이런 일이 있다"** 를 전하는',
      '것이 정직한 범위이며, 반경은 그 판단의 거리 기준이다.',
    ].join('\n'),
  })
  @ApiParam({ name: 'subscriptionId', example: 5 })
  @ApiOkData(SubscriptionAreaResponse)
  @Post(':subscriptionId/areas')
  addArea(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Body() body: AddSubscriptionAreaRequest,
  ) {
    return this.manage.addArea(subscriptionId, body);
  }

  @ApiOperation({ summary: '[관리자] 감시 구역 목록' })
  @ApiParam({ name: 'subscriptionId', example: 5 })
  @ApiOkDataArray(SubscriptionAreaResponse)
  @Get(':subscriptionId/areas')
  listAreas(@Param('subscriptionId', ParseIntPipe) subscriptionId: number) {
    return this.manage.listAreas(subscriptionId);
  }

  @ApiOperation({
    summary: '[관리자] 감시 구역 삭제',
    description: '그 구독의 구역만 지운다. 다른 구독의 구역 id 를 주면 `removed: false` 다.',
  })
  @ApiParam({ name: 'subscriptionId', example: 5 })
  @ApiParam({ name: 'areaId', example: 9 })
  @ApiOkData(RemoveSubscriptionAreaResponse)
  @Delete(':subscriptionId/areas/:areaId')
  removeArea(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Param('areaId', ParseIntPipe) areaId: number,
  ) {
    return this.manage.removeArea(subscriptionId, areaId);
  }
}
