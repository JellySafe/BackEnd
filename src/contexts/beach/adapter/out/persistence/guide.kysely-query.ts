import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RiskLevel } from '@shared/kernel/risk-level';
import { GuideTargetType } from '../../../domain/beach-enums';
import { StaticGuideView } from '../../../domain/static-guide';
import { GuideListFilter, GuideQueryPort } from '../../../application/port/out/guide-query.port';
import { GuideTranslation, localizeGuide } from '../../../domain/guide-translation';

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

    // 한국어면 번역을 읽을 이유가 없다. 원문이 곧 답이다.
    const translations =
      filter.locale === 'ko' || rows.length === 0
        ? []
        : await this.db
            .selectFrom('static_guide_translations as t')
            .select([
              't.guide_id as guideId',
              't.locale as locale',
              't.title as title',
              't.body as body',
              't.source_hash as sourceHash',
            ])
            .where(
              't.guide_id',
              'in',
              rows.map((r) => Number(r.id)),
            )
            .where('t.locale', '=', filter.locale)
            .execute();

    const byGuide = new Map<number, GuideTranslation[]>();
    for (const t of translations) {
      const id = Number(t.guideId);
      byGuide.set(id, [
        ...(byGuide.get(id) ?? []),
        { locale: t.locale, title: t.title ?? null, body: t.body, sourceHash: t.sourceHash },
      ]);
    }

    return rows.map((row) => {
      const id = Number(row.id);
      // 번역이 없거나 **원문이 바뀐 뒤의 번역**이면 한국어로 떨어진다(도메인 주석 참고).
      const localized = localizeGuide(
        { title: row.title ?? null, body: row.body },
        byGuide.get(id) ?? [],
        filter.locale,
      );

      return {
        id,
        guideCode: row.guideCode,
        targetType: row.targetType as GuideTargetType,
        riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
        title: localized.title,
        body: localized.body,
        locale: localized.locale,
        displayOrder: Number(row.displayOrder),
      };
    });
  }
}
