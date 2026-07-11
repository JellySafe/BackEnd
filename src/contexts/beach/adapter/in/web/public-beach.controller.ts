import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  GetBeachUseCase,
  GET_BEACH_USE_CASE,
  ListBeachesUseCase,
  LIST_BEACHES_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListBeachesQuery } from './dto/list-beaches.query';

/**
 * 일반 사용자 해변 API (USR-001).
 */
@Controller('public/beaches')
export class PublicBeachController {
  constructor(
    @Inject(LIST_BEACHES_USE_CASE) private readonly listBeaches: ListBeachesUseCase,
    @Inject(GET_BEACH_USE_CASE) private readonly getBeach: GetBeachUseCase,
  ) {}

  /** USR-001 해변 검색/목록 (현재 위험 단계 포함) */
  @Get()
  list(@Query() query: ListBeachesQuery) {
    return this.listBeaches.list({ keyword: query.keyword, region: query.region });
  }

  /** 해변 마스터 단건 조회 */
  @Get(':beachId')
  get(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getBeach.get(beachId);
  }
}
