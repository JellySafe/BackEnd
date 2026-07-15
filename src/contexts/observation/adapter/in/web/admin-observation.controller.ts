import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({
    summary: '[관리자] 데이터 수집 상태 — 외부 데이터가 잘 들어오고 있나?',
    description: [
      '수온·해류 등 외부 관측 데이터 소스의 상태를 본다(SYS-001).',
      '`lastSyncedAt`(마지막 수집 시각), `lastSyncStatus`(성공/실패) 로 **수집이 멈췄는지** 확인한다.',
      '',
      '시스템 상태 점검 화면용. 수집이 끊기면 위험도 계산이 오래된 값으로 돌기 때문에 운영자가 알아야 한다.',
    ].join('\n'),
  })
  @ApiOkDataArray(DataSourceStatusResponse)
  @Get('data-sources')
  dataSources() {
    return this.listDataSources.list();
  }

  /** 최근 관측치 조회 */
  @ApiOperation({
    summary: '[관리자] 관측치 원본 조회 — 수온/해류 실측값',
    description: [
      '수집된 관측 데이터 원본. `stationId`(관측소), `from`/`to`(기간) 로 필터하고 `limit` 로 개수 제한(기본 100건).',
      '',
      '위험도 그래프를 그리거나 "왜 이 수치가 나왔나"를 확인할 때 쓴다. 조회 전용.',
    ].join('\n'),
  })
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
