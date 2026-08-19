/**
 * 스모크 테스트용 DB 준비 스크립트.
 *
 * 하는 일: 접속 대기 → 스키마 적용 → 추가 DDL 적용 → 시드.
 * 실행: npm run test:smoke (이 스크립트가 먼저 돌고 jest 가 이어진다)
 *
 * ── 스키마를 두 가지 경로로 만드는 이유 ──────────────────────────────────────────────
 * 이 프로젝트의 스키마 원본은 저장소 **밖**에 있다(`../db/jellysafe_schema.sql`, ERwin DDL).
 * 개발자 노트북에는 그 파일이 있지만 CI 러너에는 없다. 그래서:
 *
 *   파일이 있으면 → 그 DDL 을 그대로 적용한다. **운영과 같은 스키마**다(CHECK 제약, bin 콜레이션,
 *                   COMMENT 까지). 실제로 DB 제약에 막혀 저장이 안 되던 결함(#22)은 이 경로에서만 잡힌다.
 *   없으면        → `prisma db push` 로 schema.prisma 에서 테이블을 만든다. 테이블·컬럼·인덱스·FK 는
 *                   맞지만 **CHECK 제약과 콜레이션은 재현되지 않는다.**
 *
 * 이 차이를 숨기지 않고 실행 로그에 찍는다. CI 가 초록이라고 해서 "DDL 제약까지 검증됐다" 로
 * 읽으면 안 되기 때문이다. 원본 DDL 로 돌리려면 TEST_SCHEMA_SQL 에 경로를 주면 된다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createConnection, RowDataPacket } from 'mysql2/promise';

const DEFAULT_URL = 'mysql://jellysafe:jellysafe@127.0.0.1:3399/jellysafe_test';
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;

/** 스키마 원본(저장소 밖). 없으면 prisma db push 로 대체한다. */
const SCHEMA_SQL = process.env.TEST_SCHEMA_SQL ?? resolve(__dirname, '../../db/jellysafe_schema.sql');

/** 운영에 수동 적용하는 추가 DDL. 번호 순서대로 적용한다. */
const EXTRA_SQL_DIR = resolve(__dirname, '../prisma/sql');

const CONNECT_RETRIES = 60;
const CONNECT_INTERVAL_MS = 2000;

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      const conn = await createConnection(DATABASE_URL);
      await conn.end();
      console.log(`[prepare-test-db] DB 접속 확인 (${attempt}번째 시도)`);
      return;
    } catch (err) {
      if (attempt === CONNECT_RETRIES) {
        throw new Error(
          `DB 에 접속하지 못했다(${DATABASE_URL}). \`npm run db:test:up\` 으로 컨테이너를 먼저 띄운다. 원인: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await new Promise((r) => setTimeout(r, CONNECT_INTERVAL_MS));
    }
  }
}

/**
 * 기존 테이블을 전부 지운다 — **매번 같은 상태에서 시작하기 위해서다.**
 *
 * 스모크는 "시드 직후" 를 전제로 검증한다(해변 12곳, 룰 v3 …). 지난 실행이 만든 제보·토큰·산출
 * 이력이 남아 있으면 그 전제가 조용히 무너지고, 실패했을 때 코드 탓인지 잔재 탓인지 알 수 없다.
 *
 * ⚠️ 실수로 개발/운영 DB 를 가리키면 데이터를 통째로 날리는 동작이다. 그래서 **DB 이름에 'test'
 * 가 없으면 아예 실행하지 않는다.** 이름이 다른 테스트 DB 를 쓴다면 ALLOW_NON_TEST_DB=true 로
 * 의도를 밝혀야 한다(자동으로 뚫리는 길을 두지 않는다).
 */
async function resetSchema(): Promise<void> {
  const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '');
  if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== 'true') {
    throw new Error(
      `안전장치: DB 이름에 'test' 가 없다(${dbName}). 스모크 준비는 테이블을 전부 지우므로 ` +
        `개발/운영 DB 를 가리켰을 가능성을 먼저 확인한다. 의도한 것이라면 ALLOW_NON_TEST_DB=true 로 실행한다.`,
    );
  }

  const conn = await createConnection({ uri: DATABASE_URL, multipleStatements: true });
  try {
    const [rows] = await conn.query<{ TABLE_NAME: string }[] & RowDataPacket[]>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [dbName],
    );
    if (rows.length === 0) return;

    const names = rows.map((r) => `\`${r.TABLE_NAME}\``).join(', ');
    // FK 를 끄지 않으면 삭제 순서를 스스로 풀어야 한다. 어차피 전부 지우므로 끄는 편이 단순하다.
    await conn.query(`SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS ${names}; SET FOREIGN_KEY_CHECKS = 1;`);
    console.log(`[prepare-test-db] 기존 테이블 ${rows.length}개 제거 (매번 같은 상태에서 시작한다)`);
  } finally {
    await conn.end();
  }
}

/** SQL 파일 하나를 통째로 실행한다(multipleStatements). */
async function runSqlFile(path: string, tolerateErrors: boolean): Promise<void> {
  const sql = readFileSync(path, 'utf8');
  const conn = await createConnection({ uri: DATABASE_URL, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log(`[prepare-test-db] 적용: ${path}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!tolerateErrors) throw err;
    // 추가 DDL 은 "이미 없는 인덱스를 지우려는" 식으로 실패할 수 있다. 그건 문제가 아니라
    // 이미 그 상태라는 뜻이다(prisma/sql/001 주석 참고). 테이블 생성 실패라면 뒤의 시드가 깨지므로
    // 여기서 감춰도 결국 드러난다.
    console.warn(`[prepare-test-db] 건너뜀: ${path} — ${message}`);
  } finally {
    await conn.end();
  }
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL },
  });
}

async function main(): Promise<void> {
  console.log(`[prepare-test-db] 대상: ${DATABASE_URL}`);
  await waitForDatabase();
  await resetSchema();

  if (existsSync(SCHEMA_SQL)) {
    console.log(`[prepare-test-db] 스키마 원본 DDL 로 만든다 — 운영과 같은 제약이 걸린다.`);
    await runSqlFile(SCHEMA_SQL, false);
  } else {
    console.log(
      `[prepare-test-db] 스키마 원본(${SCHEMA_SQL})이 없어 prisma db push 로 만든다.\n` +
        `                  ⚠️ 테이블·인덱스·FK 는 같지만 CHECK 제약·bin 콜레이션은 재현되지 않는다.`,
    );
    run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss']);
  }

  // 운영에 수동 적용하는 DDL(신규 테이블·인덱스 정리)을 이어서 적용한다.
  // 이게 없으면 리프레시 토큰 테이블이 없는 스키마로 스모크가 돌아, 정작 검증하려던 흐름이 빠진다.
  const extras = existsSync(EXTRA_SQL_DIR)
    ? readdirSync(EXTRA_SQL_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];
  for (const file of extras) {
    await runSqlFile(join(EXTRA_SQL_DIR, file), true);
  }

  console.log('[prepare-test-db] 시드 적용');
  run('npx', ['prisma', 'db', 'seed']);

  console.log('[prepare-test-db] 준비 완료');
}

main().catch((err: unknown) => {
  console.error(`[prepare-test-db] 실패: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
