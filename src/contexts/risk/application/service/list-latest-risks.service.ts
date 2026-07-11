import { Inject, Injectable } from '@nestjs/common';
import { ListLatestRisksUseCase } from '../port/in/risk-use-cases';
import {
  LatestRiskFilter,
  LatestRiskRow,
  RiskQueryPort,
  RISK_QUERY,
} from '../port/out/risk-query.port';

/**
 * ADM-002/003 지도/리스트용 해변별 최신 위험도 목록.
 * region/level/horizon/toxicOnly 필터를 Kysely 조회로 위임한다.
 */
@Injectable()
export class ListLatestRisksService implements ListLatestRisksUseCase {
  constructor(@Inject(RISK_QUERY) private readonly query: RiskQueryPort) {}

  list(filter: LatestRiskFilter): Promise<LatestRiskRow[]> {
    return this.query.listLatest({ ...filter, horizon: filter.horizon ?? 'now' });
  }
}
