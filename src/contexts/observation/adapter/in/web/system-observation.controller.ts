import { Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import {
  MapStationsUseCase,
  MAP_STATIONS_USE_CASE,
  SyncForecastsUseCase,
  SYNC_FORECASTS_USE_CASE,
  SyncObservationsUseCase,
  SYNC_OBSERVATIONS_USE_CASE,
} from '../../../application/port/in/observation-use-cases';
import { SyncObservationsResponse } from './dto/sync-observations.response';

/**
 * SYS-001/002 데이터 수집 내부 API (POST /system/observations/sync).
 *
 * 평소에는 ObservationScheduler 의 크론이 같은 배치를 돌린다. 이 엔드포인트는
 * 크론 주기를 기다리지 않고 즉시 수집해야 할 때를 위한 수동 트리거다
 * (외부 API 키 교체 직후 확인, 장애 복구 후 따라잡기, 시연 직전 갱신 등).
 * 크론과 같은 유스케이스를 부르므로 동작은 동일하다.
 */
@ApiTags('observation')
@Controller('system/observations')
export class SystemObservationController {
  constructor(
    @Inject(SYNC_OBSERVATIONS_USE_CASE) private readonly sync: SyncObservationsUseCase,
    @Inject(MAP_STATIONS_USE_CASE) private readonly map: MapStationsUseCase,
    @Inject(SYNC_FORECASTS_USE_CASE) private readonly forecasts: SyncForecastsUseCase,
  ) {}

  @ApiOperation({
    summary: '[시스템] 외부 데이터 수집 트리거 — 프론트에서 호출하지 말 것',
    description: [
      '외부 공공데이터를 수집(SYS-001)하고 관측소-해변 매핑(SYS-002)을 갱신한다.',
      '**배치/스케줄러가 부르는 내부 API 다.** 평소에는 크론이 자동으로 돌린다.',
      '',
      '수집 소스: 국립수산과학원 해파리 주간보고, 국립해양조사원 해양관측부이, 기상청 해양기상관측.',
      '인증키가 없는 소스는 mock 으로 폴백한다.',
      '',
      '**위험도는 갱신하지 않는다.** 수집된 값을 위험도에 반영하려면 이어서',
      '`POST /system/risk/calculate` 를 호출한다(크론은 두 단계를 이어서 실행한다).',
      '',
      '⚠️ `/system/*` 경로에는 인증 가드가 없다. 배포 시 게이트웨이/방화벽에서 외부 노출을 막아야 한다.',
    ].join('\n'),
  })
  @Post('sync')
  @ApiOkData(SyncObservationsResponse)
  async syncAll(): Promise<SyncObservationsResponse> {
    const sync = await this.sync.syncAll();
    const map = await this.map.mapAll();
    // 기상 예보(해상예보)도 함께 받는다. 크론은 이미 이 세 단계를 이어서 돌린다.
    // 수동 트리거만 예보를 빠뜨리면 "수집했는데 예보가 없다"는 상태가 되어,
    // 24h/72h 가 조용히 지속성 계수 폴백으로 되돌아간다(실제로 그랬다).
    // force=true — 수동 트리거는 "지금 당장 최신을 받아라"는 뜻이다. 크론의
    // "최신 발표를 이미 갖고 있으면 건너뛴다" 최적화를 적용하면 트리거가 아무것도 안 한다.
    const forecast = await this.forecasts.syncAll(true);
    return { ...sync, ...map, forecastsFetched: forecast.fetched, forecastsSaved: forecast.saved };
  }
}
