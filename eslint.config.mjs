import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint v9 flat config.
 *
 * ── 왜 이제야 생겼나 ─────────────────────────────────────────────────────────────────
 * package.json 에 `lint` 스크립트는 있었지만 v9 가 요구하는 설정 파일이 없어 **한 번도 돌지
 * 않았다**(CI 도 그 이유로 lint 단계를 주석 처리해 뒀다). 규칙 없이 두면 규칙이 없는 것과 같다.
 *
 * ── 어떤 규칙을 켰나 ─────────────────────────────────────────────────────────────────
 * 이 저장소는 이미 tsc strict 를 통과하고 스타일도 일관돼 있다. 그래서 스타일 규칙을 새로
 * 들이밀어 수백 건의 경고를 만들지 않는다. 대신 **타입 검사가 잡지 못하는 실수**에 집중한다:
 *   - floating promise / misused promise : async 호출을 await 없이 흘려보내는 실수.
 *     이 코드베이스는 배치·알림 확산이 전부 async 라 조용히 유실되면 원인 추적이 어렵다.
 *   - no-explicit-any, no-unnecessary-type-assertion : 타입 경계가 무너지는 지점.
 *   - require-await, no-return-await 등 async 관련 잡음 제거.
 * 포매팅은 Prettier 가 담당하므로 충돌하는 규칙은 prettier config 로 전부 끈다(맨 뒤).
 */
export default tseslint.config(
  {
    // 생성물·산출물은 검사하지 않는다.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'uploads/**',
      // prisma-kysely 가 스키마에서 생성하는 파일(사람이 고치지 않는다).
      'src/shared/persistence/kysely/database.types.ts',
      'src/shared/persistence/kysely/database.enums.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        // 타입 정보를 요구하는 규칙(floating promise 등)에 필요하다.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 미사용 변수는 에러로 잡되, `_` 접두사는 의도적 미사용으로 인정한다
      // (인터페이스 구현상 받아야만 하는 인자에 쓴다).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // 템플릿 문자열의 값 표현은 이 코드베이스가 로그 문구에 광범위하게 쓴다
      // (`${err}`, `${beachId}`). 실질적 위험이 없어 끈다.
      '@typescript-eslint/restrict-template-expressions': 'off',

      // Nest 데코레이터/DI 특성상 빈 인터페이스·빈 함수가 정상적으로 나온다.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      // 안전 규칙(any 확산)은 경고로 두고 점진적으로 줄인다 — 지금 에러로 두면
      // 외부 API 응답을 다루는 수집기 어댑터가 대량으로 막힌다.
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',

      // async 관련: 여기가 이 설정의 존재 이유다.
      // 던져놓고 잊은 Promise 는 tsc 가 잡지 못하고, 이 코드베이스는 배치·알림 확산이
      // 전부 async 라 한 건이 조용히 유실되면 원인 추적이 어렵다.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // require-await 는 끈다. 이 코드베이스에서 'await 없는 async' 는 실수가 아니라
      // **계약을 맞추는 정상 코드**다 — Promise 를 반환하는 포트 인터페이스 구현,
      // NestJS 베이스 클래스의 async 메서드 오버라이드(ApiThrottlerGuard),
      // 테스트의 async 스텁이 전부 여기 걸린다. 잡히는 건 전부 거짓 양성이었다.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // 테스트는 모킹·응답 본문 접근 특성상 any/unsafe 가 불가피하다(supertest 의 res.body 는 any).
    // 그 소음을 끈다. e2e 파일명은 `*.e2e-spec.ts` 라 `*.spec.ts` 글롭에 걸리지 않으므로 함께 적는다.
    files: ['**/*.spec.ts', '**/*e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    /*
     * 시드·일회성 분석 스크립트.
     *
     * 이 파일들은 `dist` 로 나가지 않고(tsconfig.build.json 이 제외한다) 운영에서 돌지 않는다.
     * backtest-risk.ts / logistic-compare.ts 는 docs/ 의 결론을 **재현하기 위한 기록**이라,
     * 지금 와서 미사용 헬퍼를 지우면 그때 무엇을 시도했는지가 사라진다. 그래서 타입 안전성·
     * 미사용 변수 규칙은 여기서 끄되, **잘못하면 조용히 데이터가 어긋나는** async 규칙은 남긴다
     * (시드가 await 를 빠뜨리면 절반만 들어간 DB 로 개발을 시작하게 된다).
     */
    files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // 반드시 마지막: Prettier 와 충돌하는 포매팅 규칙을 전부 끈다.
  prettier,
);
