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
fallback('DATABASE_URL', process.env.TEST_DATABASE_URL ?? 'mysql://jellysafe:jellysafe@127.0.0.1:3399/jellysafe_test');
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
