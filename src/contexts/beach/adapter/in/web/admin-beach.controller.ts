import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { normalizePageRequest } from '@shared/kernel/pagination';
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

/**
 * 관리자 해변 마스터 API (ADM-005).
 */
@Controller('admin/beaches')
export class AdminBeachController {
  constructor(
    @Inject(LIST_ADMIN_BEACHES_USE_CASE) private readonly listBeaches: ListAdminBeachesUseCase,
    @Inject(CREATE_BEACH_USE_CASE) private readonly createBeach: CreateBeachUseCase,
    @Inject(UPDATE_BEACH_USE_CASE) private readonly updateBeach: UpdateBeachUseCase,
  ) {}

  /** ADM-005 해변 마스터 목록 */
  @Get()
  list(@Query() query: ListAdminBeachesQuery) {
    const page = normalizePageRequest(query.page, query.size);
    return this.listBeaches.list(
      { keyword: query.keyword, region: query.region, isActive: query.isActive },
      page,
    );
  }

  /** ADM-005 해변 등록 */
  @Post()
  create(@Body() body: CreateBeachRequest) {
    return this.createBeach.create({
      name: body.name,
      region: body.region,
      lat: body.lat,
      lng: body.lng,
      facingDirection: body.facingDirection ?? null,
      priority: body.priority,
      vulnerabilityScore: body.vulnerabilityScore,
    });
  }

  /** ADM-005 해변 수정 */
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
      vulnerabilityScore: body.vulnerabilityScore,
      isActive: body.isActive,
    });
  }
}
