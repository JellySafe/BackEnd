import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { normalizePageRequest } from '@shared/kernel/pagination';
import { ApiOkData, ApiOkPage } from '@shared/http/api-response.decorator';
import {
  CreateBeachUseCase,
  CREATE_BEACH_USE_CASE,
  ListAdminBeachesUseCase,
  LIST_ADMIN_BEACHES_USE_CASE,
  UpdateBeachUseCase,
  UPDATE_BEACH_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListAdminBeachesQuery } from './dto/list-admin-beaches.query';
import { CreateBeachRequest } from './dto/create-beach.request';
import { UpdateBeachRequest } from './dto/update-beach.request';
import { BeachAdminItemResponse } from './dto/beach-admin-item.response';
import { BeachDetailResponse } from './dto/beach-detail.response';

/**
 * 관리자 해변 마스터 API (ADM-005).
 */
@ApiTags('beach')
@ApiBearerAuth('bearer')
@Controller('admin/beaches')
export class AdminBeachController {
  constructor(
    @Inject(LIST_ADMIN_BEACHES_USE_CASE) private readonly listBeaches: ListAdminBeachesUseCase,
    @Inject(CREATE_BEACH_USE_CASE) private readonly createBeach: CreateBeachUseCase,
    @Inject(UPDATE_BEACH_USE_CASE) private readonly updateBeach: UpdateBeachUseCase,
  ) {}

  /** ADM-005 해변 마스터 목록 */
  @ApiOperation({
    summary: '[관리자] 해변 마스터 목록 — 해변 관리 화면의 표',
    description: [
      '등록된 해변 전체 목록(ADM-005). 비활성 해변도 보인다.',
      '`keyword`, `region`, `isActive` 로 필터. 페이지네이션(`page`, `size`).',
      '',
      '앱용 `GET /public/beaches` 와 달리 **위험도는 안 들어있다.** 여긴 해변 정보 관리용 표다.',
    ].join('\n'),
  })
  @ApiOkPage(BeachAdminItemResponse)
  @Get()
  list(@Query() query: ListAdminBeachesQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listBeaches.list(
      { keyword: query.keyword, region: query.region, isActive: query.isActive },
      page,
    );
  }

  /** ADM-005 해변 등록 */
  @ApiOperation({
    summary: '[관리자] 해변 등록 — 새 해변 추가',
    description: [
      '관리 대상 해변을 새로 등록한다(ADM-005).',
      '',
      '- `lat`/`lng` : 위험도 계산이 이 좌표로 관측 데이터를 매칭하므로 정확해야 한다.',
      '- `priority` : 대시보드 정렬 우선순위',
    ].join('\n'),
  })
  @ApiOkData(BeachDetailResponse)
  @Post()
  create(@Body() body: CreateBeachRequest) {
    return this.createBeach.create({
      name: body.name,
      region: body.region,
      lat: body.lat,
      lng: body.lng,
      facingDirection: body.facingDirection ?? null,
      priority: body.priority,
      imageUrl: body.imageUrl,
    });
  }

  /** ADM-005 해변 수정 */
  @ApiOperation({
    summary: '[관리자] 해변 수정 — 보낸 필드만 바뀜 (PATCH)',
    description: [
      '해변 정보를 수정한다(ADM-005). **PATCH 라서 바꿀 필드만 보내면 된다** — 안 보낸 값은 그대로 유지.',
      '',
      '`isActive: false` 로 두면 삭제 대신 **비활성 처리**된다(앱 목록에서 사라짐). 해변 삭제 API 는 없다.',
    ].join('\n'),
  })
  @ApiOkData(BeachDetailResponse)
  @Patch(':beachId')
  update(@Param('beachId', ParseIntPipe) beachId: number, @Body() body: UpdateBeachRequest) {
    return this.updateBeach.update({
      beachId,
      name: body.name,
      region: body.region,
      lat: body.lat,
      lng: body.lng,
      facingDirection: body.facingDirection,
      priority: body.priority,
      imageUrl: body.imageUrl,
      isActive: body.isActive,
    });
  }
}
