import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from './kysely/kysely.service';
import { SCHEMA_REQUIREMENTS, SchemaRequirement } from './schema-requirements';

/**
 * 기동 시 **코드가 가정하는 스키마가 실제로 있는지** 확인한다.
 *
 * ── 막으려는 사고 ────────────────────────────────────────────────────────────────────
 * DB-first 라 운영에 `prisma migrate` 를 쓰지 않는다. `prisma/sql/*.sql` 을 사람이 적용하므로
 * **코드만 배포되고 DDL 이 빠지는 일**이 구조적으로 가능하다.
 *
 * ⚠️ 그때 앱은 멀쩡히 뜨고 **조용히 못 한다.** `missing_factors` 가 없으면 위험도 저장이 매번
 *    실패해 시민 화면에 아무 단계도 안 나오는데, 기동 로그는 정상이고 실패는 한 시간 뒤
 *    배치에서 처음 드러난다. 그 한 시간은 하필 배포 직후다.
 *
 * ── 두 가지 실패를 다르게 다룬다 ─────────────────────────────────────────────────────
 *   · **없는 것을 확인함**  → 기동을 막는다. 조용히 못 하는 것보다 안 뜨는 편이 낫다.
 *   · **확인 자체가 실패함** → 경고만 남기고 통과시킨다.
 *
 * 뒤를 통과시키는 이유 — 관리형 DB 에서 `information_schema` 권한이 제한될 수 있는데,
 * **점검기가 서비스 전면 중단의 원인이 되면 안 된다.** 레이트 리밋이 Redis 장애 때
 * fail-open 하는 것과 같은 기준이다. 대신 로그에 크게 남긴다.
 */
@Injectable()
export class SchemaGuard implements OnModuleInit {
  private readonly logger = new Logger(SchemaGuard.name);

  constructor(private readonly db: KyselyService) {}

  async onModuleInit(): Promise<void> {
    let missing: SchemaRequirement[];

    try {
      missing = await this.findMissing(SCHEMA_REQUIREMENTS);
    } catch (err) {
      // 점검기가 장애의 원인이 되면 안 된다(위 주석).
      this.logger.warn(
        '스키마 점검을 하지 못했습니다 — **DDL 누락을 확인하지 못한 채 기동합니다.** ' +
          'information_schema 권한을 확인하세요: ' +
          (err instanceof Error ? err.message : String(err)),
      );
      return;
    }

    if (missing.length === 0) {
      this.logger.log(`스키마 점검 통과 (${SCHEMA_REQUIREMENTS.length}개 요소)`);
      return;
    }

    // 무엇을, 왜, 어떻게 고치는지를 한 번에 준다. 기동을 막을 때는 다음 행동이 분명해야 한다.
    const lines = missing.map(
      (r) =>
        `  · ${r.table}${r.column ? `.${r.column}` : ''} 없음 → ${r.breaks}\n` +
        `    적용: mysql -u <user> -p <db> < prisma/sql/${r.sqlFile}`,
    );

    throw new Error(
      `DB 스키마가 코드보다 뒤쳐져 있습니다 (${missing.length}건).\n` +
        `${lines.join('\n')}\n` +
        '이 상태로 뜨면 앱은 정상으로 보이지만 위 기능이 조용히 실패합니다. 그래서 기동을 막습니다.',
    );
  }

  /** 없는 요소만 돌려준다. 테이블이 없으면 그 테이블의 컬럼 요구는 중복으로 세지 않는다. */
  private async findMissing(
    requirements: readonly SchemaRequirement[],
  ): Promise<SchemaRequirement[]> {
    const tables = [...new Set(requirements.map((r) => r.table))];

    const tableRows = await sql<{ TABLE_NAME: string }>`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(tables)})
    `.execute(this.db);
    const existingTables = new Set(tableRows.rows.map((r) => r.TABLE_NAME));

    const columnRows = await sql<{ TABLE_NAME: string; COLUMN_NAME: string }>`
      SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${sql.join(tables)})
    `.execute(this.db);
    const existingColumns = new Set(
      columnRows.rows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`),
    );

    return requirements.filter((r) => {
      if (!existingTables.has(r.table)) {
        // 테이블이 통째로 없으면 그 테이블을 요구하는 항목 하나만 보고한다.
        return r.column === undefined;
      }
      return r.column !== undefined && !existingColumns.has(`${r.table}.${r.column}`);
    });
  }
}
