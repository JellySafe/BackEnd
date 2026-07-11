import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RiskLevel } from '@shared/kernel/risk-level';
import { GuideTargetType } from '../../../domain/beach-enums';
import { StaticGuideView } from '../../../domain/static-guide';
import { GuideListFilter, GuideQueryPort } from '../../../application/port/out/guide-query.port';

/**
 * 안내/고지 문구 조회 어댑터 (Kysely, G-006).
 * 활성(active=1) 문구만 targetType/riskLevel 로 필터링해 displayOrder 순으로 반환한다.
 */
@Injectable()
export class GuideKyselyQuery implements GuideQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(filter: GuideListFilter): Promise<StaticGuideView[]> {
    let q = this.db.selectFrom('static_guides as g').where('g.active', '=', 1);

    if (filter.targetType) q = q.where('g.target_type', '=', filter.targetType);
    if (filter.riskLevel) q = q.where('g.risk_level', '=', filter.riskLevel);

    const rows = await q
      .select([
        'g.id as id',
        'g.guide_code as guideCode',
        'g.target_type as targetType',
        'g.risk_level as riskLevel',
        'g.title as title',
        'g.body as body',
        'g.display_order as displayOrder',
      ])
      .orderBy('g.display_order', 'asc')
      .orderBy('g.id', 'asc')
      .execute();

    return rows.map((row) => ({
      id: Number(row.id),
      guideCode: row.guideCode,
      targetType: row.targetType as GuideTargetType,
      riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
      title: row.title ?? null,
      body: row.body,
      displayOrder: Number(row.displayOrder),
    }));
  }
}
