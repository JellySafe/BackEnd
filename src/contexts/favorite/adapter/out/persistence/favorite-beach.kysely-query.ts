import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RiskLevel, isRiskLevel } from '@shared/kernel/risk-level';
import {
  FavoriteListItem,
  FavoriteQueryPort,
} from '../../../application/port/out/favorite-query.port';
import { FavoriteOwner } from '../../../domain/favorite-beach';

/**
 * 관심 해변 목록 조회 어댑터 (Kysely).
 * favorite_beaches × beaches × risk_scores(now, is_latest) 조인으로
 * 각 관심 해변의 현재 위험단계를 함께 반환한다.
 */
@Injectable()
export class FavoriteBeachKyselyQuery implements FavoriteQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listWithRisk(owner: FavoriteOwner): Promise<FavoriteListItem[]> {
    let q = this.db
      .selectFrom('favorite_beaches as f')
      .innerJoin('beaches as b', 'b.id', 'f.beach_id')
      .leftJoin('risk_scores as rs', (join) =>
        join
          .onRef('rs.beach_id', '=', 'f.beach_id')
          .on('rs.horizon', '=', 'now')
          .on('rs.is_latest', '=', 1),
      )
      .select([
        'f.id as favoriteId',
        'f.beach_id as beachId',
        'b.name as beachName',
        'b.region as region',
        'rs.risk_level as currentRiskLevel',
        'rs.risk_score as currentRiskScore',
        'f.created_at as createdAt',
      ])
      .orderBy('f.created_at', 'desc');

    // normalizeOwner 로 정확히 한 식별자만 설정됨.
    if (owner.userId !== null) {
      q = q.where('f.user_id', '=', owner.userId);
    } else {
      q = q.where('f.user_token', '=', owner.userToken);
    }

    const rows = await q.execute();

    return rows.map((row) => ({
      favoriteId: Number(row.favoriteId),
      beachId: Number(row.beachId),
      beachName: row.beachName,
      region: row.region,
      currentRiskLevel: isRiskLevel(row.currentRiskLevel)
        ? (row.currentRiskLevel as RiskLevel)
        : null,
      currentRiskScore: row.currentRiskScore === null ? null : Number(row.currentRiskScore),
      createdAt: new Date(row.createdAt),
    }));
  }
}
