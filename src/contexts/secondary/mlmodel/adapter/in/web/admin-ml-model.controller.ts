import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { normalizePageRequest, offsetOf } from '@shared/kernel/pagination';
import {
  ListModelsUseCase,
  LIST_MODELS_USE_CASE,
  RegisterModelUseCase,
  REGISTER_MODEL_USE_CASE,
} from '../../../application/port/in/ml-model-use-cases';
import { RegisterModelRequest } from './dto/register-model.request';
import { RegisterModelResponse, ListModelsResponse } from './dto/ml-model.response';

/**
 * [2차] ML 모델 관리 API (EX-003 MLOps). 골격 — 학습/배포 파이프라인은 2차 범위.
 */
@ApiTags('secondary-mlmodel')
@ApiBearerAuth('bearer')
@Controller('admin/ml-models')
export class AdminMlModelController {
  constructor(
    @Inject(REGISTER_MODEL_USE_CASE) private readonly registerModel: RegisterModelUseCase,
    @Inject(LIST_MODELS_USE_CASE) private readonly listModels: ListModelsUseCase,
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
  @ApiOkData(ListModelsResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const models = await this.listModels.list(req.size, offsetOf(req));
    return { note: '[2차] EX-003 모델 관리 골격', models };
  }
}
