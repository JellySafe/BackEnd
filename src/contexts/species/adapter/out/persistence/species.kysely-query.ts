import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { JellyfishSpeciesView } from '../../../domain/jellyfish-species';
import { isToxicityLevel } from '../../../domain/species-enums';
import { SpeciesQueryPort } from '../../../application/port/out/species-query.port';

/**
 * 해파리 도감 조회 어댑터 (Kysely).
 * 활성 종만 displayOrder 순으로 반환한다. 14행짜리 참조 데이터라 필터/페이징을 두지 않는다.
 */
@Injectable()
export class SpeciesKyselyQuery implements SpeciesQueryPort {
  constructor(private readonly db: KyselyService) {}

  async list(): Promise<JellyfishSpeciesView[]> {
    const rows = await this.db
      .selectFrom('jellyfish_species as s')
      .where('s.active', '=', 1)
      .select([
        's.id as id',
        's.korean_name as koreanName',
        's.scientific_name as scientificName',
        's.toxicity as toxicity',
        's.features as features',
        's.appearance_season as appearanceSeason',
        's.sting_symptom as stingSymptom',
        's.image_url as imageUrl',
        's.image_source as imageSource',
        's.image_source_url as imageSourceUrl',
        's.display_order as displayOrder',
      ])
      .orderBy('s.display_order', 'asc')
      .orderBy('s.id', 'asc')
      .execute();

    return rows.map((row) => ({
      id: Number(row.id),
      koreanName: row.koreanName,
      scientificName: row.scientificName ?? null,
      // DB CHECK 가 값 목록을 강제하지만, 계약 밖 값이 들어오면 조용히 통과시키지 않고 null 로 떨어뜨린다.
      // (등급을 잘못 표시하느니 미공표로 두는 편이 안전하다)
      toxicity: isToxicityLevel(row.toxicity) ? row.toxicity : null,
      features: row.features ?? null,
      appearanceSeason: row.appearanceSeason ?? null,
      stingSymptom: row.stingSymptom ?? null,
      imageUrl: row.imageUrl ?? null,
      imageSource: row.imageSource ?? null,
      imageSourceUrl: row.imageSourceUrl ?? null,
      displayOrder: Number(row.displayOrder),
    }));
  }
}
