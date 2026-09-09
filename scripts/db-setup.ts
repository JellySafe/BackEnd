/**
 * DB 준비 공용 부분 — 접속 대기와 SQL 파일 적용.
 *
 * 테스트용(prepare-test-db)과 개발용(prepare-dev-db)이 **같은 일을 서로 다르게 하지 않도록**
 * 여기 모았다. 특히 "추가 DDL 을 번호 순서대로, 이미 적용된 것은 넘기며 적용" 하는 규칙이
 * 두 벌이 되면 한쪽만 고쳐진다 — 그러면 개발 DB 에만 CHECK 제약이 빠지는 식이 된다.
 *
 * 두 스크립트가 **다르게** 하는 것은 따로 둔다.
 *   · 테스트용 : 시작할 때 테이블을 전부 지운다(매번 같은 상태에서 시작해야 하므로)
 *   · 개발용   : 지우지 않는다(어제 만든 제보가 오늘도 있어야 하므로)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'mysql2/promise';

const CONNECT_RETRIES = 60;
const CONNECT_INTERVAL_MS = 2000;

/** DB 가 받을 준비가 될 때까지 기다린다. 컨테이너를 막 띄운 직후를 위해 필요하다. */
export async function waitForDatabase(options: {
  databaseUrl: string;
  logPrefix: string;
  /** 접속에 실패했을 때 알려줄 복구 명령. "왜 안 되지" 로 헤매지 않게 한다. */
  upCommand: string;
}): Promise<void> {
  for (let attempt = 1; attempt <= CONNECT_RETRIES; attempt++) {
    try {
      const conn = await createConnection(options.databaseUrl);
      await conn.end();
      console.log(`${options.logPrefix} DB 접속 확인 (${attempt}번째 시도)`);
      return;
    } catch (err) {
      if (attempt === CONNECT_RETRIES) {
        throw new Error(
          `DB 에 접속하지 못했다(${options.databaseUrl}). \`${options.upCommand}\` 로 컨테이너를 먼저 띄운다. 원인: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await new Promise((r) => setTimeout(r, CONNECT_INTERVAL_MS));
    }
  }
}

/** SQL 파일 하나를 통째로 실행한다(multipleStatements). */
export async function runSqlFile(options: {
  databaseUrl: string;
  path: string;
  tolerateErrors: boolean;
  logPrefix: string;
}): Promise<void> {
  const sql = readFileSync(options.path, 'utf8');
  const conn = await createConnection({ uri: options.databaseUrl, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log(`${options.logPrefix} 적용: ${options.path}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!options.tolerateErrors) throw err;
    // 추가 DDL 은 "이미 없는 인덱스를 지우려는" 식으로 실패할 수 있다. 그건 문제가 아니라
    // 이미 그 상태라는 뜻이다(prisma/sql/001 주석 참고). 테이블 생성 실패라면 뒤의 시드가 깨지므로
    // 여기서 감춰도 결국 드러난다.
    console.warn(`${options.logPrefix} 건너뜀: ${options.path} — ${message}`);
  } finally {
    await conn.end();
  }
}

/**
 * 운영에 **수동으로 적용하는** DDL(`prisma/sql/*.sql`)을 번호 순서대로 적용한다.
 *
 * 이게 빠지면 리프레시 토큰·정답 데이터 테이블이 없는 스키마가 되고, CHECK 제약도 걸리지
 * 않는다. `prisma db push` 는 `schema.prisma` 만 보므로 이 파일들을 알지 못한다.
 */
export async function applyManualDdl(options: {
  databaseUrl: string;
  dir: string;
  logPrefix: string;
}): Promise<void> {
  if (!existsSync(options.dir)) return;

  const files = readdirSync(options.dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await runSqlFile({
      databaseUrl: options.databaseUrl,
      path: join(options.dir, file),
      tolerateErrors: true,
      logPrefix: options.logPrefix,
    });
  }
}
