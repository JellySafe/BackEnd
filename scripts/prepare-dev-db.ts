/**
 * 개발용 DB 준비 스크립트.
 *
 * 하는 일: 접속 대기 → 스키마 적용 → 추가 DDL 적용 → 시드.
 * 실행: `npm run db:dev:init` (컨테이너는 `npm run db:dev:up` 이 먼저 띄운다)
 *
 * ── 테스트용(prepare-test-db)과 무엇이 다른가 ────────────────────────────────────────
 * **테이블을 지우지 않는다.** 그것이 이 스크립트가 따로 있는 이유의 전부다.
 *
 * 스모크는 "시드 직후" 를 전제로 검증하므로 매번 테이블을 전부 지우고 시작한다. 개발 DB 에
 * 같은 짓을 하면 어제 만든 제보·계정·산출 이력이 사라진다. 그래서 이쪽은 **더하기만** 한다 —
 * 이미 있는 테이블·컬럼·제약은 건너뛴다.
 *
 * 처음부터 다시 만들고 싶으면 `npm run db:dev:reset` 을 쓴다(볼륨째 지우고 다시 만든다).
 * 지우는 동작을 별도 명령으로 떼어 둔 것도 의도다 — 실수로 부르기 어려워야 한다.
 *
 * ── 스키마를 만드는 경로 ─────────────────────────────────────────────────────────────
 * 스키마 원본(`../db/jellysafe_schema.sql`)이 있으면 그것을, 없으면 `prisma db push` 를 쓴다.
 * 앞은 운영과 같은 DDL 이고(CHECK 제약·콜레이션·COMMENT 까지), 뒤는 테이블·인덱스·FK 만 같다.
 * 어느 경로로 만들었는지는 로그에 찍는다 — 그 차이를 모르고 "운영과 같은 스키마" 로 착각하면
 * DB 제약에 막히는 결함(#22 같은)이 로컬에서 재현되지 않는다.
 *
 * 다만 `prisma/sql/999-check-constraints.sql` 은 어느 경로에서도 적용되므로, push 로 만들어도
 * **CHECK 제약은 걸린다.**
 */
// ts-node 는 .env 를 알아서 읽지 않는다. 개발 서버(main.ts)가 보는 것과 **같은 DATABASE_URL**
// 을 써야 하므로 여기서 명시적으로 읽는다 — 다르면 서버는 A 를, 준비 스크립트는 B 를 본다.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyManualDdl, runSqlFile, waitForDatabase } from './db-setup';

const LOG = '[prepare-dev-db]';

/**
 * 대상 DB. `.env` 의 DATABASE_URL 을 그대로 쓴다 — 개발 서버가 붙는 곳과 같아야 하기 때문이다.
 * (여기서 별도 기본값을 두면 서버는 A 를, 준비 스크립트는 B 를 보는 상태가 만들어진다)
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';

/** 스키마 원본(저장소 밖). 없으면 prisma db push 로 대체한다. */
const SCHEMA_SQL = process.env.DEV_SCHEMA_SQL ?? resolve(__dirname, '../../db/jellysafe_schema.sql');

/** 운영에 수동 적용하는 추가 DDL. 번호 순서대로 적용한다. */
const EXTRA_SQL_DIR = resolve(__dirname, '../prisma/sql');

function run(command: string, args: string[]): void {
  execFileSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL },
  });
}

/**
 * 테스트 DB 를 가리키고 있으면 멈춘다.
 *
 * 이름이 비슷해 `.env` 를 잘못 두면 개발 준비가 테스트 DB 를 시드해 버린다. 곧바로 사고가
 * 나지는 않지만, 다음 스모크가 "시드 직후" 가 아닌 상태에서 시작해 엉뚱한 실패를 낸다.
 */
function rejectTestDatabase(): void {
  if (/test/i.test(DATABASE_URL)) {
    throw new Error(
      `DATABASE_URL 이 테스트 DB 를 가리킨다(${DATABASE_URL}).\n` +
        '  개발 DB 로 바꾼다 — docker-compose.dev.yml 기준 3400 포트, DB 이름 jellysafe_dev.\n' +
        '  테스트 DB 준비는 `npm run test:smoke` 가 알아서 한다.',
    );
  }
}

async function main(): Promise<void> {
  if (DATABASE_URL.trim().length === 0) {
    throw new Error('DATABASE_URL 이 비어 있다. `.env.example` 을 `.env` 로 복사해 채운다.');
  }
  rejectTestDatabase();

  console.log(`${LOG} 대상: ${DATABASE_URL}`);
  await waitForDatabase({ databaseUrl: DATABASE_URL, logPrefix: LOG, upCommand: 'npm run db:dev:up' });

  if (existsSync(SCHEMA_SQL)) {
    console.log(`${LOG} 스키마 원본 DDL 로 만든다 — 운영과 같은 제약이 걸린다.`);
    await runSqlFile({ databaseUrl: DATABASE_URL, path: SCHEMA_SQL, tolerateErrors: true, logPrefix: LOG });
  } else {
    console.log(
      `${LOG} 스키마 원본(${SCHEMA_SQL})이 없어 prisma db push 로 만든다.\n` +
        `${LOG} ⚠️ 테이블·인덱스·FK 는 같지만 콜레이션·COMMENT 는 운영과 다르다(CHECK 제약은 아래에서 걸린다).`,
    );
    run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss']);
  }

  console.log(`${LOG} 추가 DDL 적용 (리프레시 토큰·정답 데이터·CHECK 제약)`);
  await applyManualDdl({ databaseUrl: DATABASE_URL, dir: EXTRA_SQL_DIR, logPrefix: LOG });

  console.log(`${LOG} 시드 적용 (이미 있는 행은 건너뛴다)`);
  run('npx', ['prisma', 'db', 'seed']);

  console.log(`${LOG} 준비 완료 — \`npm run start:dev\` 로 서버를 띄운다.`);
}

main().catch((err: unknown) => {
  console.error(`${LOG} 실패:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
