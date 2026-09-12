import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { toId } from '@shared/kernel/id';
import { kstDayWindow } from '@shared/kernel/kst-date';
import {
  BeachObservationCoverage,
  ObservationCoverageQueryPort,
} from '../../../application/port/out/groundtruth-ports';

/**
 * 하루치 관측 기록 현황 어댑터 (Kysely).
 *
 * ── 왜 LEFT JOIN 이 아니라 두 번 읽나 ────────────────────────────────────────────────
 * "해변마다 그날의 **마지막** 기록" 은 LEFT JOIN 으로는 한 번에 못 가져온다(그룹당 최신 행을
 * 고르려면 윈도 함수나 상관 서브쿼리가 필요하다). 대상이 작으므로 — 해변 12곳, 하루 기록은
 * 많아야 수십 건 — 그날 기록을 통째로 읽어 JS 에서 접는다. 질의가 단순해지고 의도가 드러난다.
 *
 * KST 하루 윈도우로 자른다. 운영자가 보는 "오늘" 과 집계 구간이 어긋나면 저녁에 남긴 기록이
 * 내일 것으로 잡힌다(observed_at 은 UTC DATETIME 이다).
 */
@Injectable()
export class ObservationCoverageKyselyQuery implements ObservationCoverageQueryPort {
  constructor(private readonly db: KyselyService) {}

  async coverageFor(dateKey: Date): Promise<BeachObservationCoverage[]> {
    const { start, end } = kstDayWindow(dateKey);

    const [beaches, records] = await Promise.all([
      this.db
        .selectFrom('beaches')
        .select(['id as beachId', 'name', 'region'])
        .where('is_active', '=', 1)
        .orderBy('priority', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      this.db
        .selectFrom('field_observations')
        .select([
          'beach_id as beachId',
          'observed_at as observedAt',
          'jellyfish_present as jellyfishPresent',
          'observer_name as observerName',
        ])
        .where('observed_at', '>=', start)
        .where('observed_at', '<', end)
        // 같은 해변에 여러 건이면 마지막 것을 쓴다. 아래 fold 가 뒤엣것으로 덮는다.
        .orderBy('observed_at', 'asc')
        .orderBy('id', 'asc')
        .execute(),
    ]);

    const lastByBeach = new Map<number, (typeof records)[number]>();
    for (const record of records) lastByBeach.set(Number(record.beachId), record);

    return beaches.map((beach) => {
      const last = lastByBeach.get(Number(beach.beachId));
      return {
        beachId: toId(beach.beachId),
        beachName: beach.name,
        region: beach.region,
        recorded: last !== undefined,
        lastObservedAt: last?.observedAt ?? null,
        // MySQL BOOLEAN 은 tinyint 라 생성 타입이 number 다.
        jellyfishPresent: last === undefined ? null : Boolean(last.jellyfishPresent),
        observerName: last?.observerName ?? null,
      };
    });
  }
}
