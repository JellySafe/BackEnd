/**
 * 스모크 테스트 환경 변수 (jest `setupFiles` — 테스트 파일보다 **먼저** 실행된다).
 *
 * AppModule 을 import 하는 순간 `ConfigModule.forRoot({ validate })` 가 평가되면서 env 검증이
 * 돌기 때문에, 값 설정이 그보다 앞서야 한다. 그래서 테스트 파일 안이 아니라 여기서 세팅한다.
 *
 * 이미 지정된 값은 덮어쓰지 않는다 — CI 나 개발자가 다른 DB·키를 쓸 수 있어야 한다.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fallback(key: string, value: string): void {
  if (!process.env[key] || process.env[key] === '') process.env[key] = value;
}

fallback('NODE_ENV', 'test');

/**
 * 스모크가 붙을 DB.
 *
 * ── 왜 fallback 이 아니라 덮어쓰는가 ────────────────────────────────────────────────
 * 준비 스크립트(prepare-test-db)는 `TEST_DATABASE_URL` 을 보고, 테스트는 `DATABASE_URL` 을
 * 본다. 그래서 셸에 `DATABASE_URL` 이 이미 있으면 **준비한 DB 와 테스트가 보는 DB 가 갈라진다.**
 * 스키마를 A 에 만들고 테스트는 B 에 붙는 상태인데, 증상은 "테이블이 없다"나 드라이버 오류처럼
 * 원인과 멀어 보이는 형태로 나온다(실제로 겪었다 — 다른 MySQL 에 붙어 인증 플러그인 오류가 났다).
 *
 * 스모크는 **항상 테스트 DB 를 봐야 한다.** 그래서 `TEST_DATABASE_URL` 이 있으면 그것으로
 * 덮어쓴다. CI 는 둘을 같은 값으로 주므로 영향이 없다(.github/workflows/smoke.yml).
 */
const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'mysql://jellysafe:jellysafe@127.0.0.1:3399/jellysafe_test';
process.env.DATABASE_URL = TEST_DB;

/**
 * 안전장치. 준비 스크립트와 같은 규칙이다 — 스모크는 테이블을 지우고 시드를 다시 넣는 DB 를
 * 전제로 돌기 때문에, 이름에 `test` 가 없으면 개발/운영 DB 를 가리켰을 가능성을 먼저 의심한다.
 */
const dbName = new URL(TEST_DB).pathname.replace(/^\//, '');
if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== 'true') {
  throw new Error(
    `안전장치: 스모크가 붙을 DB 이름에 'test' 가 없다(${dbName}). ` +
      'TEST_DATABASE_URL 을 확인한다. 의도한 것이라면 ALLOW_NON_TEST_DB=true 로 실행한다.',
  );
}
fallback('JWT_SECRET', 'smoke-test-secret-0123456789abcdef0123456789');
fallback('JWT_EXPIRES', '1h');
fallback('SYSTEM_API_KEY', 'smoke-test-system-key');
fallback('API_PREFIX', 'api');

// 스케줄러는 끈다. 스모크가 검증하는 것은 요청-응답이고, 배치가 같은 DB 를 동시에 건드리면
// 결과가 흔들린다(위험도 재산출이 테스트 중간에 끼어드는 식으로).
fallback('SCHEDULER_ENABLED', 'false');

// 시드가 넣는 점수표 버전. 운영과 같은 v3 로 검증한다.
fallback('RISK_RULE_VERSION', 'v3');

// 실 수집기를 부르지 않는다(외부 API 키가 없고, 스모크는 외부 의존을 타면 안 된다).
fallback('MOCK_COLLECTOR_FALLBACK', 'true');

// 업로드 경로는 매 실행마다 임시 디렉터리. 저장소·개발 환경을 더럽히지 않는다.
fallback('UPLOAD_DIR', mkdtempSync(join(tmpdir(), 'jellysafe-smoke-')));
