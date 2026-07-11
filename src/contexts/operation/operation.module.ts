import { Module } from '@nestjs/common';
import { UserModule } from '@contexts/user/user.module';
import { AdminOperationController } from './adapter/in/web/admin-operation.controller';
import { AuditAdapter } from './adapter/out/audit.adapter';
import { OperationActionPrismaRepository } from './adapter/out/persistence/operation-action.prisma-repository';
import { OperationKyselyQuery } from './adapter/out/persistence/operation.kysely-query';
import { RecommendationKyselyQuery } from './adapter/out/persistence/recommendation.kysely-query';
import { GetRecommendationsService } from './application/service/get-recommendations.service';
import { RecordOperationActionService } from './application/service/record-operation-action.service';
import { ListOperationActionsService } from './application/service/list-operation-actions.service';
import { GetOperationStatusService } from './application/service/get-operation-status.service';
import { OPERATION_ACTION_REPOSITORY } from './application/port/out/operation-action-repository.port';
import { OPERATION_QUERY } from './application/port/out/operation-query.port';
import { RECOMMENDATION_QUERY } from './application/port/out/recommendation-query.port';
import {
  GET_OPERATION_STATUS_USE_CASE,
  GET_RECOMMENDATIONS_USE_CASE,
  LIST_OPERATION_ACTIONS_USE_CASE,
  RECORD_OPERATION_ACTION_USE_CASE,
} from './application/port/in/operation-use-cases';
import { AUDIT_PORT } from './application/port/out/audit.port';

/**
 * operation 컨텍스트 (운영 대응 권고/운영 상태·대응 기록). ADM-006/007.
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리)를
 * DI 토큰으로 어댑터에 바인딩한다.
 */
@Module({
  imports: [UserModule],
  controllers: [AdminOperationController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: GET_RECOMMENDATIONS_USE_CASE, useClass: GetRecommendationsService },
    { provide: RECORD_OPERATION_ACTION_USE_CASE, useClass: RecordOperationActionService },
    { provide: LIST_OPERATION_ACTIONS_USE_CASE, useClass: ListOperationActionsService },
    { provide: GET_OPERATION_STATUS_USE_CASE, useClass: GetOperationStatusService },
    // 아웃바운드 포트 → 어댑터
    { provide: OPERATION_ACTION_REPOSITORY, useClass: OperationActionPrismaRepository },
    { provide: OPERATION_QUERY, useClass: OperationKyselyQuery },
    { provide: RECOMMENDATION_QUERY, useClass: RecommendationKyselyQuery },
    // 감사 아웃바운드 포트 → user 컨텍스트 위임 어댑터 (AUTH-002)
    { provide: AUDIT_PORT, useClass: AuditAdapter },
  ],
})
export class OperationModule {}
