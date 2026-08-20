import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@shared/auth/auth.decorators';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  ListModelsUseCase,
  LIST_MODELS_USE_CASE,
  ManageModelUseCase,
  MANAGE_MODEL_USE_CASE,
  RegisterModelUseCase,
  REGISTER_MODEL_USE_CASE,
} from '../../../application/port/in/ml-model-use-cases';
import { RegisterModelRequest } from './dto/register-model.request';
import { RegisterModelResponse, ListModelsResponse } from './dto/ml-model.response';
import {
  ChangeModelStatusRequest,
  ModelSummaryResponse,
  RecordModelMetricsRequest,
} from './dto/model-lifecycle.dto';
import { ModelPurpose, ModelStatus, MODEL_PURPOSES } from '../../../domain/ml-model';

/**
 * [2차] ML 모델 관리 API (EX-003 MLOps). 골격 — 학습/배포 파이프라인은 2차 범위.
 */
@ApiTags('secondary-mlmodel')
@ApiBearerAuth('bearer')
@Roles('admin')
@Controller('admin/ml-models')
export class AdminMlModelController {
  constructor(
    @Inject(REGISTER_MODEL_USE_CASE) private readonly registerModel: RegisterModelUseCase,
    @Inject(LIST_MODELS_USE_CASE) private readonly listModels: ListModelsUseCase,
    @Inject(MANAGE_MODEL_USE_CASE) private readonly manageModel: ManageModelUseCase,
  ) {}

  /** [2차] 모델 등록 */
  @ApiOperation({
    summary: '[2차 확장] ML 모델 등록 — MVP 에서는 사용하지 않음',
    description: [
      '해파리 판별 모델 버전을 등록하는 골격(EX-003).',
      '',
      '⚠️ **2차 확장 골격이라 지금 붙일 필요 없다.** 실제 로직 대신 자리만 잡아둔 상태이고,',
      '응답에 `note: "[2차] ..."` 가 그대로 들어있다. MVP 화면 연동 대상이 아니다.',
    ].join('\n'),
  })
  @ApiOkData(RegisterModelResponse)
  @Post()
  async register(@Body() body: RegisterModelRequest) {
    const model = await this.registerModel.register(body);
    return { note: '[2차] EX-003 모델 관리 골격', model };
  }

  /** [2차] 모델 목록 */
  @ApiOperation({
    summary: '[2차 확장] ML 모델 목록 — MVP 에서는 사용하지 않음',
    description: [
      '등록된 모델 목록 조회 골격(EX-003).',
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
  @ApiOkData(ListModelsResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const models = await this.listModels.list(req.size, offsetOf(req));
    return { note: '[2차] EX-003 모델 관리 골격', models };
  }

  // --- 생애 관리 (EX-003) -----------------------------------------------------------

  @ApiOperation({
    summary: '[관리자] 모델 상태 변경 — 학습 → 검증 → 운영',
    description: [
      '모델 상태는 **무엇이 지금 판단을 내리고 있는가**를 가리킨다. 그래서 순서를 강제한다:',
      '`training → staging → active → archived`. 되돌리는 길은 보관(archived)뿐이며,',
      '**보관은 종착**이다 — 다시 쓰려면 새 버전으로 등록한다(같은 버전이 두 번 운영되면 그 사이',
      '어떤 판단이 어느 아티팩트에서 나왔는지 추적할 수 없다).',
      '',
      '`active` 로 올리면 **같은 용도의 기존 활성 모델은 자동으로 보관된다**(한 트랜잭션).',
      '한 용도에 활성 모델이 둘이면 사후 검증이 불가능해진다.',
    ].join('\n'),
  })
  @ApiParam({ name: 'modelId', example: 3 })
  @ApiOkData(ModelSummaryResponse)
  @Patch(':modelId/status')
  changeStatus(
    @Param('modelId', ParseIntPipe) modelId: number,
    @Body() body: ChangeModelStatusRequest,
  ) {
    return this.manageModel.changeStatus(modelId, body.status as ModelStatus);
  }

  @ApiOperation({
    summary: '[관리자] 모델 성능 지표 기록',
    description: [
      '지표 이름은 자유롭게(auc, recall, f1 …), **값은 숫자만** 받는다.',
      '문자열이 섞이면 나중에 비교·집계가 깨진다("0.87" 과 0.87 은 다른 값으로 다뤄진다).',
      '',
      '모니터링 화면은 이 값을 시계열로 읽어 모델 교체 전후를 비교한다.',
    ].join('\n'),
  })
  @ApiParam({ name: 'modelId', example: 3 })
  @ApiOkData(ModelSummaryResponse)
  @Patch(':modelId/metrics')
  recordMetrics(
    @Param('modelId', ParseIntPipe) modelId: number,
    @Body() body: RecordModelMetricsRequest,
  ) {
    return this.manageModel.recordMetrics(modelId, body.metrics);
  }

  @ApiOperation({
    summary: '[관리자] 현재 활성 모델 조회',
    description: [
      '그 용도의 활성 모델을 준다. 없으면 `null` 이다.',
      '',
      '참고 — **위험도(risk_prediction)는 지금 모델이 아니라 룰이 산출한다.** 백테스트에서',
      '로지스틱 회귀가 룰 v3 에 유의하게 패배했기 때문이다(docs/logistic-vs-rules.md).',
      '그래서 이 조회는 대개 vision 용도에만 값이 있고, 룰이 만든 점수에는 모델 id 를 달지 않는다',
      '(달면 거짓 기록이 된다).',
    ].join('\n'),
  })
  @ApiQuery({ name: 'purpose', enum: MODEL_PURPOSES, example: 'vision' })
  @ApiOkData(ModelSummaryResponse)
  @Get('active')
  getActive(@Query('purpose') purpose: ModelPurpose) {
    return this.manageModel.getActive(purpose);
  }
}
