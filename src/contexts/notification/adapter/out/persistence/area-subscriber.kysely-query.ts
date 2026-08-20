import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id, toId } from '@shared/kernel/id';
import { haversineKm } from '@contexts/observation/domain/geo';
import {
  AreaSubscriber,
  AreaSubscriberQueryPort,
} from '../../../application/port/out/area-subscriber-query.port';

/**
 * 해역 구독자 조회 어댑터 (Kysely, EX-004).
 *
 * ── 반경 판정을 SQL 이 아니라 여기서 하는 이유 ───────────────────────────────────────
 * 반경 판정은 두 좌표의 거리 비교라 SQL 로 쓰면 **인덱스를 쓸 수 없는 조건**이 된다(컬럼에
 * 함수를 씌운다). 그런데 활성 구독의 구역 수는 많아야 수백 건이고, 이 조회는 위험 단계가
 * 오를 때만 돈다. 전부 읽어 애플리케이션에서 거르는 편이 단순하고 충분히 빠르다.
 * (같은 이유로 PAST_OCCURRENCE 는 반대 방향으로 갔다 — 그쪽은 30분마다 큰 테이블을 훑어서
 *  SQL 조건을 인덱스가 타게 바꿔야 했다. 규모와 빈도가 판단 기준이다)
 *
 * ── 왜 notification 이 구독 테이블을 읽나 ────────────────────────────────────────────
 * 알림 확산의 대상 목록을 만드는 일이라 알림 컨텍스트의 읽기 모델로 둔다(같은 컨텍스트의
 * beach-risk.kysely-query 가 risk 테이블을 읽는 것과 같은 방식). 구독의 상태 규칙은 secondary
 * 컨텍스트가 소유하고, 여기서는 그 결과(active)만 조건으로 쓴다.
 */
@Injectable()
export class AreaSubscriberKyselyQuery implements AreaSubscriberQueryPort {
  constructor(private readonly db: KyselyService) {}

  async findByBeach(beachId: Id): Promise<AreaSubscriber[]> {
    const beach = await this.db
      .selectFrom('beaches as b')
      .select(['b.lat as lat', 'b.lng as lng'])
      .where('b.id', '=', beachId)
      .executeTakeFirst();

    const rows = await this.db
      .selectFrom('subscription_areas as a')
      .innerJoin('subscriptions as s', 's.id', 'a.subscription_id')
      .select([
        's.user_id as userId',
        'a.beach_id as areaBeachId',
        'a.label as label',
        'a.center_lat as centerLat',
        'a.center_lng as centerLng',
        'a.radius_km as radiusKm',
      ])
      // 활성 구독만. 정지·해지·만료는 알림 대상이 아니다.
      .where('s.subscription_status', '=', 'active')
      .execute();

    const matched = new Map<number, AreaSubscriber>();
    for (const row of rows) {
      if (!this.covers(row, beachId, beach)) continue;

      const userId = toId(row.userId);
      // 한 사람이 여러 구역으로 걸려도 알림은 한 번이다.
      if (!matched.has(userId)) {
        matched.set(userId, { userId, areaLabel: row.label ?? null });
      }
    }
    return [...matched.values()];
  }

  /** 구역이 그 해변을 감시하는가. 해변 직접 지정 또는 좌표 반경. */
  private covers(
    row: {
      areaBeachId: number | null;
      centerLat: unknown;
      centerLng: unknown;
      radiusKm: unknown;
    },
    beachId: Id,
    beach: { lat: unknown; lng: unknown } | undefined,
  ): boolean {
    if (row.areaBeachId !== null && toId(row.areaBeachId) === beachId) return true;

    const centerLat = numberOf(row.centerLat);
    const centerLng = numberOf(row.centerLng);
    const radiusKm = numberOf(row.radiusKm);
    const beachLat = numberOf(beach?.lat);
    const beachLng = numberOf(beach?.lng);
    if (
      centerLat === null ||
      centerLng === null ||
      radiusKm === null ||
      beachLat === null ||
      beachLng === null
    ) {
      return false;
    }

    return (
      haversineKm({ lat: centerLat, lng: centerLng }, { lat: beachLat, lng: beachLng }) <= radiusKm
    );
  }
}

/** DECIMAL 컬럼은 드라이버에 따라 문자열로 온다. 숫자로 정리하고, 아니면 null. */
function numberOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
