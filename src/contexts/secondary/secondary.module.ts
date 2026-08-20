import { Module } from '@nestjs/common';
import { RiskModule } from '@contexts/risk/risk.module';
// partner (EX-001)
import { AdminPartnerController } from './partner/adapter/in/web/admin-partner.controller';
import { PartnerRiskController } from './partner/adapter/in/web/partner-risk.controller';
import { PartnerAuthGuard } from './partner/adapter/in/web/partner-auth.guard';
import { PartnerCallLogInterceptor } from './partner/adapter/in/web/partner-call-log.interceptor';
import { PartnerRateLimiter } from './partner/adapter/in/web/partner-rate-limiter';
import { PartnerPrismaRepository } from './partner/adapter/out/persistence/partner.prisma-repository';
import { PartnerApiKeyPrismaRepository } from './partner/adapter/out/persistence/partner-api-key.prisma-repository';
import { PartnerApiKeyService } from './partner/application/service/partner-api-key.service';
import { PARTNER_API_KEY_REPOSITORY } from './partner/application/port/out/partner-api-key-repository.port';
import { RegisterPartnerService } from './partner/application/service/register-partner.service';
import { ListPartnersService } from './partner/application/service/list-partners.service';
import { PARTNER_REPOSITORY } from './partner/application/port/out/partner-repository.port';
import {
  AUTHENTICATE_PARTNER_USE_CASE,
  ISSUE_API_KEY_USE_CASE,
  LIST_PARTNERS_USE_CASE,
  MANAGE_API_KEY_USE_CASE,
  RECORD_PARTNER_CALL_USE_CASE,
  REGISTER_PARTNER_USE_CASE,
} from './partner/application/port/in/partner-use-cases';
// subscription (EX-002)
import { AdminSubscriptionController } from './subscription/adapter/in/web/admin-subscription.controller';
import { SubscriptionPrismaRepository } from './subscription/adapter/out/persistence/subscription.prisma-repository';
import { CreateSubscriptionService } from './subscription/application/service/create-subscription.service';
import { ManageSubscriptionService } from './subscription/application/service/manage-subscription.service';
import { ListSubscriptionsService } from './subscription/application/service/list-subscriptions.service';
import { SUBSCRIPTION_REPOSITORY } from './subscription/application/port/out/subscription-repository.port';
import {
  CREATE_SUBSCRIPTION_USE_CASE,
  LIST_SUBSCRIPTIONS_USE_CASE,
  MANAGE_SUBSCRIPTION_USE_CASE,
} from './subscription/application/port/in/subscription-use-cases';
// mlmodel (EX-003)
import { AdminMlModelController } from './mlmodel/adapter/in/web/admin-ml-model.controller';
import { MlModelPrismaRepository } from './mlmodel/adapter/out/persistence/ml-model.prisma-repository';
import { RegisterModelService } from './mlmodel/application/service/register-model.service';
import { ManageModelService } from './mlmodel/application/service/manage-model.service';
import { ListModelsService } from './mlmodel/application/service/list-models.service';
import { ML_MODEL_REPOSITORY } from './mlmodel/application/port/out/ml-model-repository.port';
import {
  LIST_MODELS_USE_CASE,
  MANAGE_MODEL_USE_CASE,
  REGISTER_MODEL_USE_CASE,
} from './mlmodel/application/port/in/ml-model-use-cases';
// dispatch / notification consent (EX-004) — repository 스텁만 (컨트롤러 없음)
import { NotificationDispatchPrismaRepository } from './dispatch/adapter/out/persistence/notification-dispatch.prisma-repository';
import { NotificationConsentPrismaRepository } from './dispatch/adapter/out/persistence/notification-consent.prisma-repository';
import { NOTIFICATION_DISPATCH_REPOSITORY } from './dispatch/application/port/out/notification-dispatch-repository.port';
import { NOTIFICATION_CONSENT_REPOSITORY } from './dispatch/application/port/out/notification-consent-repository.port';

/**
 * [2차] secondary 컨텍스트 골격 (EX-001~004). MVP 범위 밖의 확장 지점을 헥사고날 뼈대로 남긴다.
 *  - partner       : EX-001 외부 연동 API (GET/POST /admin/partners)
 *  - subscription  : EX-002 어업/양식 구독 (GET/POST /admin/subscriptions)
 *  - mlmodel       : EX-003 모델 관리/MLOps (GET/POST /admin/ml-models)
 *  - dispatch      : EX-004 다채널 발송/수신동의 (repository 스텁, 컨트롤러 없음)
 * app.module 등록은 별도(범위 밖). 이 모듈 하나로 2차 provider 를 모두 묶는다.
 */
@Module({
  imports: [RiskModule],
  controllers: [
    AdminPartnerController,
    // 제휴사가 실제로 호출하는 API (키 인증 + 범위 + 호출 제한 + 과금 로그)
    PartnerRiskController,
    AdminSubscriptionController,
    AdminMlModelController,
  ],
  providers: [
    // partner
    { provide: REGISTER_PARTNER_USE_CASE, useClass: RegisterPartnerService },
    // API 키 발급·검증·호출 기록은 한 서비스가 맡는다(같은 키 규칙을 공유한다).
    PartnerApiKeyService,
    { provide: ISSUE_API_KEY_USE_CASE, useExisting: PartnerApiKeyService },
    { provide: MANAGE_API_KEY_USE_CASE, useExisting: PartnerApiKeyService },
    { provide: AUTHENTICATE_PARTNER_USE_CASE, useExisting: PartnerApiKeyService },
    { provide: RECORD_PARTNER_CALL_USE_CASE, useExisting: PartnerApiKeyService },
    { provide: PARTNER_API_KEY_REPOSITORY, useClass: PartnerApiKeyPrismaRepository },
    PartnerAuthGuard,
    PartnerCallLogInterceptor,
    PartnerRateLimiter,
    { provide: LIST_PARTNERS_USE_CASE, useClass: ListPartnersService },
    { provide: PARTNER_REPOSITORY, useClass: PartnerPrismaRepository },
    // subscription
    { provide: CREATE_SUBSCRIPTION_USE_CASE, useClass: CreateSubscriptionService },
    // 상태·결제·감시 구역 (EX-004). 활성 구독만 해역 알림을 받는다.
    { provide: MANAGE_SUBSCRIPTION_USE_CASE, useClass: ManageSubscriptionService },
    { provide: LIST_SUBSCRIPTIONS_USE_CASE, useClass: ListSubscriptionsService },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: SubscriptionPrismaRepository },
    // mlmodel
    { provide: REGISTER_MODEL_USE_CASE, useClass: RegisterModelService },
    // 상태 전이·지표·활성 모델 조회 (EX-003). 한 용도에 활성 모델은 하나다.
    { provide: MANAGE_MODEL_USE_CASE, useClass: ManageModelService },
    { provide: LIST_MODELS_USE_CASE, useClass: ListModelsService },
    { provide: ML_MODEL_REPOSITORY, useClass: MlModelPrismaRepository },
    // dispatch (스텁)
    { provide: NOTIFICATION_DISPATCH_REPOSITORY, useClass: NotificationDispatchPrismaRepository },
    { provide: NOTIFICATION_CONSENT_REPOSITORY, useClass: NotificationConsentPrismaRepository },
  ],
})
export class SecondaryModule {}
