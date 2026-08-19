import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
 * 전역 JwtAuthGuard 가 /admin 경로를 보호하며, 기록 주체(createdBy)는
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
  @ApiOperation({
    summary: '[관리자] 대응 권고 — "이 해변, 지금 뭘 해야 하나?"',
    description: [
      '해변의 **현재 위험 단계에 맞는 권장 조치**를 준다(ADM-006). 예: "입욕 통제", "안내방송 실시".',
      '',
      '해변 상세 화면에서 위험도 아래에 붙이는 영역. 운영자는 이걸 보고 실제 조치를 한 뒤',
      '`POST /admin/operation-actions` 로 기록을 남긴다.',
      '',
      '참고: `GET /admin/recommendations`(beach 태그)는 단계별 권고 **마스터 전체**를 보는 API 이고,',
      '이건 특정 해변의 **지금 단계**에 해당하는 것만 골라준다.',
    ].join('\n'),
  })
  @ApiOkData(RecommendationViewResponse)
  @Get('beaches/:beachId/recommendations')
  recommendations(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getRecommendations.getRecommendations(beachId);
  }

  /** ADM-007 대응 기록 저장 */
  @ApiOperation({
    summary: '[관리자] 대응 기록 저장 — 조치한 내용 남기기 (operator 이상)',
    description: [
      '운영자가 실제로 취한 조치를 기록한다(ADM-007). **`operator` 또는 `admin` 만** 가능.',
      '',
      '- `operationStatus` : 조치 후 해변 운영 상태(예: 통제/부분개장/정상)',
      '- `actionType`, `memo` : 무슨 조치를 했는지',
      '',
      '**기록자는 body 로 보내지 않는다.** 서버가 Bearer 토큰에서 자동으로 꺼내 저장한다.',
      '',
      '저장하면 그 해변의 최신 운영 상태(`GET .../operation-status`)가 이 값으로 갱신된다.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 대응 이력 — 이 해변에 지금까지 한 조치들',
    description: [
      '해변의 대응 기록을 **시간순 이력**으로 준다. 해변 상세의 "대응 이력" 탭.',
      '페이지네이션(`page`, `size`).',
      '',
      '"지금 상태" 하나만 필요하면 `GET .../operation-status` 를 쓰는 게 가볍다.',
    ].join('\n'),
  })
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
  @ApiOperation({
    summary: '[관리자] 현재 운영 상태 — 이 해변 지금 통제 중인가?',
    description: [
      '가장 최근 대응 기록 기준의 **현재 운영 상태 한 건**만 준다. 상세 화면 상단 배지에 쓴다.',
      '',
      '위험도(자동 계산값)와는 다른 축이다. 위험도가 danger 여도 운영자가 아직 통제 조치를 안 했으면',
      '운영 상태는 정상일 수 있다 — 두 값을 같이 보여주는 게 맞다.',
    ].join('\n'),
  })
  @ApiOkData(OperationStatusResponse)
  @Get('beaches/:beachId/operation-status')
  status(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getOperationStatus.getStatus(beachId);
  }
}
