import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  @ApiOkData(RegisterModelResponse)
  @Post()
  async register(@Body() body: RegisterModelRequest) {
    const model = await this.registerModel.register(body);
    return { note: '[2차] EX-003 모델 관리 골격', model };
  }

  /** [2차] 모델 목록 */
  @ApiOkData(ListModelsResponse)
  @Get()
  async list(@Query('page') page?: number, @Query('size') size?: number) {
    const req = normalizePageRequest(Number(page), Number(size));
    const models = await this.listModels.list(req.size, offsetOf(req));
    return { note: '[2차] EX-003 모델 관리 골격', models };
  }
}
