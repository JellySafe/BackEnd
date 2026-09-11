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
import { BeachMappingDiagnosticsResponse } from './dto/mapping-diagnostics.response';
import {
  MAPPING_DIAGNOSTICS_QUERY,
  MappingDiagnosticsQueryPort,
} from '../../../application/port/out/mapping-diagnostics-query.port';

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
    // 진단 조회는 유스케이스를 거치지 않고 읽기 모델을 바로 쓴다. 도메인 규칙이 없는
    // **운영 점검용 조회**라, 유스케이스를 하나 만들어 그대로 통과시키면 계층만 늘어난다.
    @Inject(MAPPING_DIAGNOSTICS_QUERY)
    private readonly mappingDiagnostics: MappingDiagnosticsQueryPort,
  ) {}

  /** 해변↔관측소 매핑 진단 */
  @ApiOperation({
    summary: '[관리자] 해변이 어느 관측소를 보고 있나 — 위험도의 근거를 확인한다',
    description: [
      '해변마다 연결된 관측소와 **그 관측소가 살아 있는지**를 함께 준다.',
      '',
      '매핑은 배치가 좌표 거리로 자동 생성한다. 그런데 그 결과가 곧 위험도의 근거다 —',
      '해변에서 40km 떨어진 관측소의 수온으로 `낮음` 이 나와도 **화면만 봐서는 알 수 없다.**',
      '지금까지 이걸 확인하려면 DB 를 직접 열어야 했다.',
      '',
      '**무엇을 보나**',
      '- `distanceKm` : 멀수록 그 값이 이 해변을 대표하지 못한다',
      '- `isPrimary` : 위험도 산출이 우선적으로 읽는 관측소',
      '- `ageMinutes` : 수집 주기가 30분이므로 60분을 넘으면 끊긴 것이다',
      '- `stations` 가 **빈 배열** : 매핑 자체가 없다 → 관측 기반 위험도를 낼 수 없다',
      '',
      '⚠️ 실제로 **해변 12곳 중 5곳이 관측 데이터를 받지 못해** 공개 화면에서 `unknown` 으로',
      '집계된다. 그 원인이 매핑인지 수집인지 가르는 것이 이 API 의 목적이다.',
      '',
      '매핑이 없는 해변도 목록에서 빼지 않는다 — 빼면 정작 가장 문제인 해변이 보이지 않는다.',
    ].join('\n'),
  })
  @ApiOkDataArray(BeachMappingDiagnosticsResponse)
  @Get('observation-mappings')
  listMappings() {
    return this.mappingDiagnostics.listByBeach(new Date());
  }

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
