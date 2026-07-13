import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import { ApiOkData, ApiOkPage } from '@shared/http/api-response.decorator';
import {
  GetOperationStatusUseCase,
  GET_OPERATION_STATUS_USE_CASE,
  GetRecommendationsUseCase,
  GET_RECOMMENDATIONS_USE_CASE,
  ListOperationActionsUseCase,
  LIST_OPERATION_ACTIONS_USE_CASE,
  RecordOperationActionUseCase,
  RECORD_OPERATION_ACTION_USE_CASE,
} from '../../../application/port/in/operation-use-cases';
import { RecordOperationActionRequest } from './dto/record-operation-action.request';
import { ListOperationActionsQuery } from './dto/list-operation-actions.query';
import { RecommendationViewResponse } from './dto/recommendation-view.response';
import { RecordOperationActionResponse } from './dto/record-operation-action.response';
import { OperationActionListItemResponse } from './dto/operation-action-list-item.response';
import { OperationStatusResponse } from './dto/operation-status.response';

/**
 * 관리자 운영 대응 API (ADM-006 대응 권고, ADM-007 운영상태/대응기록).
 * 전역 AdminAuthGuard 가 /admin 경로를 보호하며, 기록 주체(createdBy)는
 * @CurrentUser 로 꺼낸 인증 주체(user.userId)를 사용한다.
 */
@ApiTags('operation')
@ApiBearerAuth('bearer')
@Controller('admin')
export class AdminOperationController {
  constructor(
    @Inject(GET_RECOMMENDATIONS_USE_CASE)
    private readonly getRecommendations: GetRecommendationsUseCase,
    @Inject(RECORD_OPERATION_ACTION_USE_CASE)
    private readonly recordOperationAction: RecordOperationActionUseCase,
    @Inject(LIST_OPERATION_ACTIONS_USE_CASE)
    private readonly listOperationActions: ListOperationActionsUseCase,
    @Inject(GET_OPERATION_STATUS_USE_CASE)
    private readonly getOperationStatus: GetOperationStatusUseCase,
  ) {}

  /** ADM-006 해변 현재 위험단계 대응 권고 조회 */
  @ApiOkData(RecommendationViewResponse)
  @Get('beaches/:beachId/recommendations')
  recommendations(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getRecommendations.getRecommendations(beachId);
  }

  /** ADM-007 대응 기록 저장 */
  @ApiOkData(RecordOperationActionResponse)
  @Post('operation-actions')
  @Roles('operator', 'admin')
  record(
    @Body() body: RecordOperationActionRequest,
    @CurrentUser() user: AuthUser,
  ) {
    return this.recordOperationAction.record({
      beachId: body.beachId,
      operationStatus: body.operationStatus,
      actionType: body.actionType ?? null,
      memo: body.memo ?? null,
      riskScoreId: body.riskScoreId ?? null,
      recommendationId: body.recommendationId ?? null,
      createdBy: user.userId,
    });
  }

  /** 대응 이력 목록 조회 */
  @ApiOkPage(OperationActionListItemResponse)
  @Get('beaches/:beachId/operation-actions')
  list(
    @Param('beachId', ParseIntPipe) beachId: number,
    @Query() query: ListOperationActionsQuery,
  ) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listOperationActions.list(beachId, page);
  }

  /** 최신 운영 상태 조회 */
  @ApiOkData(OperationStatusResponse)
  @Get('beaches/:beachId/operation-status')
  status(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getOperationStatus.getStatus(beachId);
  }
}
