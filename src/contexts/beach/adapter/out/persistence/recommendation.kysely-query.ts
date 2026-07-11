import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RiskLevel } from '@shared/kernel/risk-level';
import { RiskRecommendationView } from '../../../domain/risk-recommendation';
import {
  RecommendationListFilter,
  RecommendationQueryPort,
} from '../../../application/port/out/recommendation-query.port';

/**
 * 대응 권고 마스터 조회 어댑터 (Kysely, ADM-006).
 * 활성(active=1) 권고만 riskLevel 로 필터링해 displayOrder 순으로 반환한다.
 */
@Injectable()
export class RecommendationKyselyQuery implements RecommendationQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(filter: RecommendationListFilter): Promise<RiskRecommendationView[]> {
    let q = this.db.selectFrom('risk_recommendations as r').where('r.active', '=', 1);

    if (filter.riskLevel) q = q.where('r.risk_level', '=', filter.riskLevel);

    const rows = await q
      .select([
        'r.id as id',
        'r.action_code as actionCode',
        'r.risk_level as riskLevel',
        'r.title as title',
        'r.description as description',
        'r.display_order as displayOrder',
      ])
      .orderBy('r.risk_level', 'asc')
      .orderBy('r.display_order', 'asc')
      .execute();

    return rows.map((row) => ({
      id: Number(row.id),
      actionCode: row.actionCode,
      riskLevel: row.riskLevel as RiskLevel,
      title: row.title,
      description: row.description ?? null,
      displayOrder: Number(row.displayOrder),
    }));
  }
}
