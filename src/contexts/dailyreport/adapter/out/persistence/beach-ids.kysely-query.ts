import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { BeachIdsQueryPort } from '../../../application/port/out/beach-ids-query.port';

/**
 * 활성 해변 id 조회 어댑터 (Kysely, 읽기 전용).
 * SYS-006 일간 리포트 스케줄러가 순회할 해변 목록을 beaches(is_active=1)에서 가져온다.
 */
@Injectable()
export class BeachIdsKyselyQuery implements BeachIdsQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listActiveBeachIds(): Promise<Id[]> {
    const rows = await this.db
      .selectFrom('beaches')
      .select('id')
      .where('is_active', '=', 1)
      .orderBy('id', 'asc')
      .execute();

    return rows.map((row) => Number(row.id));
  }
}
