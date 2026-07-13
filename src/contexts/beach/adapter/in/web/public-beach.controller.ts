import { Controller, Get, Inject, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData, ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  GetBeachUseCase,
  GET_BEACH_USE_CASE,
  ListBeachesUseCase,
  LIST_BEACHES_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListBeachesQuery } from './dto/list-beaches.query';
import { BeachListItemResponse } from './dto/beach-list-item.response';
import { BeachDetailResponse } from './dto/beach-detail.response';

/**
 * 일반 사용자 해변 API (USR-001).
 */
@ApiTags('beach')
@Controller('public/beaches')
export class PublicBeachController {
  constructor(
    @Inject(LIST_BEACHES_USE_CASE) private readonly listBeaches: ListBeachesUseCase,
    @Inject(GET_BEACH_USE_CASE) private readonly getBeach: GetBeachUseCase,
  ) {}

  /** USR-001 해변 검색/목록 (현재 위험 단계 포함) */
  @ApiOperation({
    summary: '[앱] 해변 목록/검색 — 홈 화면의 해변 리스트',
    description: [
      '앱 첫 화면(USR-001). 해변 목록을 각 해변의 **현재 위험 단계와 함께** 내려준다.',
      '리스트에 위험 배지를 그리려고 해변마다 위험도 API 를 따로 부를 필요가 없다.',
      '',
      '`keyword`(이름 검색), `region`(지역 필터) 로 좁힐 수 있다. 인증 불필요.',
    ].join('\n'),
  })
  @ApiOkDataArray(BeachListItemResponse)
  @Get()
  list(@Query() query: ListBeachesQuery) {
    return this.listBeaches.list({ keyword: query.keyword, region: query.region });
  }

  /** 해변 마스터 단건 조회 */
  @ApiOperation({
    summary: '[앱] 해변 기본 정보 단건 — 이름/위치 같은 고정 정보',
    description: [
      '해변의 **변하지 않는 정보**(이름, 지역, 위도·경도 등)만 준다.',
      '',
      '⚠️ 위험 단계는 여기 없다. 상세 화면에서 위험도를 그릴 거면 `GET /public/beaches/{beachId}/risk` 를 써야 한다.',
      '지도에 핀을 찍거나 해변 이름을 표시할 때 쓴다. 인증 불필요.',
    ].join('\n'),
  })
  @ApiOkData(BeachDetailResponse)
  @Get(':beachId')
  get(@Param('beachId', ParseIntPipe) beachId: number) {
    return this.getBeach.get(beachId);
  }
}
