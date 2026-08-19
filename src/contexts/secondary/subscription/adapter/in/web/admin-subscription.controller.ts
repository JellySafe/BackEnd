import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  CreateSubscriptionUseCase,
  CREATE_SUBSCRIPTION_USE_CASE,
  ListSubscriptionsUseCase,
  LIST_SUBSCRIPTIONS_USE_CASE,
} from '../../../application/port/in/subscription-use-cases';
import { CreateSubscriptionRequest } from './dto/create-subscription.request';
import { CreateSubscriptionResponse, ListSubscriptionsResponse } from './dto/subscription.response';

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
}
