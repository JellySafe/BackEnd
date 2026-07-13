import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  ListDataSourcesUseCase,
  LIST_DATA_SOURCES_USE_CASE,
  ListObservationsUseCase,
  LIST_OBSERVATIONS_USE_CASE,
} from '../../../application/port/in/observation-use-cases';
import { ListObservationsQuery } from './dto/list-observations.query';
import { DataSourceStatusResponse } from './dto/data-source-status.response';
import { ObservationResponse } from './dto/observation.response';

const DEFAULT_OBSERVATION_LIMIT = 100;

/**
 * 관리자 데이터 수집 조회 API (SYS-001 상태 점검).
 * GET /admin/data-sources : 수집 소스 상태(lastSyncedAt/lastSyncStatus 포함)
 * GET /admin/observations : 최근 관측치 조회(stationId/from/to 필터)
 */
@ApiTags('observation')
@ApiBearerAuth('bearer')
@Controller('admin')
export class AdminObservationController {
  constructor(
    @Inject(LIST_DATA_SOURCES_USE_CASE) private readonly listDataSources: ListDataSourcesUseCase,
    @Inject(LIST_OBSERVATIONS_USE_CASE) private readonly listObservations: ListObservationsUseCase,
  ) {}

  /** 수집 소스 상태 조회 */
  @ApiOkDataArray(DataSourceStatusResponse)
  @Get('data-sources')
  dataSources() {
    return this.listDataSources.list();
  }

  /** 최근 관측치 조회 */
  @ApiOkDataArray(ObservationResponse)
  @Get('observations')
  observations(@Query() query: ListObservationsQuery) {
    return this.listObservations.list(
      {
        stationId: query.stationId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      },
      query.limit ?? DEFAULT_OBSERVATION_LIMIT,
    );
  }
}
