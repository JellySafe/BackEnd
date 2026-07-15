import { Inject, Injectable } from '@nestjs/common';
import { BeachQueryPort, BEACH_QUERY } from '@contexts/beach/application/port/out/beach-query.port';
import { BeachCandidate } from '../../domain/nearest-beach';
import { BeachLocationPort } from '../../application/port/out/beach-location.port';

/**
 * 해변 좌표 조회 어댑터.
 * report 의 BeachLocationPort 를 beach 컨텍스트의 조회 포트(BEACH_QUERY) 위임으로 구현한다.
 * beach 는 report 를 참조하지 않으므로 순환 의존이 없다.
 */
@Injectable()
export class BeachLocationAdapter implements BeachLocationPort {
  constructor(@Inject(BEACH_QUERY) private readonly beachQuery: BeachQueryPort) {}

  async listBeachLocations(): Promise<BeachCandidate[]> {
    const rows = await this.beachQuery.listLocations();
    return rows.map((row) => ({
      beachId: row.beachId,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      isActive: row.isActive,
    }));
  }
}
