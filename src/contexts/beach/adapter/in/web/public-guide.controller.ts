import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  ListGuidesUseCase,
  LIST_GUIDES_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListGuidesQuery } from './dto/list-guides.query';
import { StaticGuideResponse } from './dto/static-guide.response';

/**
 * 안내/고지 문구 API (G-006). 로그인 없이 조회 가능.
 */
@ApiTags('beach')
@Controller('public/guides')
export class PublicGuideController {
  constructor(@Inject(LIST_GUIDES_USE_CASE) private readonly listGuides: ListGuidesUseCase) {}

  /** G-006 활성 안내 문구 조회 (targetType/riskLevel 필터) */
  @ApiOkDataArray(StaticGuideResponse)
  @Get()
  list(@Query() query: ListGuidesQuery) {
    return this.listGuides.list({ targetType: query.targetType, riskLevel: query.riskLevel });
  }
}
