import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { RiskLevel } from '@shared/kernel/risk-level';
import {
  RecommendationItem,
  RecommendationQueryPort,
  RecommendationView,
} from '../../../application/port/out/recommendation-query.port';

/**
 * 대응 권고 조회 어댑터 (Kysely). ADM-006.
 * 해변의 현재 위험단계(risk_scores now/latest)를 구한 뒤 그 단계의 활성 권고를 조회한다.
 * 위험도가 없으면 currentRiskLevel=null, 빈 목록.
 */
@Injectable()
export class RecommendationKyselyQuery implements RecommendationQueryPort {
  constructor(private readonly db: KyselyService) {}

  async getForBeach(beachId: Id): Promise<RecommendationView> {
    const scoreRow = await this.db
      .selectFrom('risk_scores as rs')
      .select('rs.risk_level as riskLevel')
      .where('rs.beach_id', '=', beachId)
      .where('rs.horizon', '=', 'now')
      .where('rs.is_latest', '=', 1)
      .limit(1)
      .executeTakeFirst();

    const currentRiskLevel = scoreRow ? (scoreRow.riskLevel as RiskLevel) : null;
    if (!currentRiskLevel) {
      return { beachId, currentRiskLevel: null, recommendations: [] };
    }

    const rows = await this.db
      .selectFrom('risk_recommendations as rr')
      .select([
        'rr.id as recommendationId',
        'rr.action_code as actionCode',
        'rr.risk_level as riskLevel',
        'rr.title as title',
        'rr.description as description',
        'rr.display_order as displayOrder',
      ])
      .where('rr.risk_level', '=', currentRiskLevel)
      .where('rr.active', '=', 1)
      .orderBy('rr.display_order', 'asc')
      .execute();

    const recommendations: RecommendationItem[] = rows.map((row) => ({
      recommendationId: Number(row.recommendationId),
      actionCode: row.actionCode,
      riskLevel: row.riskLevel as RiskLevel,
      title: row.title,
      description: row.description ?? null,
      displayOrder: Number(row.displayOrder),
    }));

    return { beachId, currentRiskLevel, recommendations };
  }
}
