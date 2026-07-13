import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
@Controller('admin/subscriptions')
export class AdminSubscriptionController {
  constructor(
    @Inject(CREATE_SUBSCRIPTION_USE_CASE)
    private readonly createSubscription: CreateSubscriptionUseCase,
    @Inject(LIST_SUBSCRIPTIONS_USE_CASE)
    private readonly listSubscriptions: ListSubscriptionsUseCase,
  ) {}

  /** [2차] 구독 생성 */
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
  @ApiOkData(ListSubscriptionsResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const subscriptions = await this.listSubscriptions.list(req.size, offsetOf(req));
    return { note: '[2차] EX-002 구독 골격', subscriptions };
  }
}
