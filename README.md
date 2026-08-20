# JellySafe Backend

제주 연안 해파리 위험도 예측/대응 지원 서비스의 백엔드. **NestJS + TypeScript**, **헥사고날 아키텍처(포트 & 어댑터)** 로 구현했다.

- 영속성: **Prisma**(쓰기·단순 CRUD·트랜잭션) + **Kysely**(대시보드 집계·필터 조회 등 복잡 조회) 병행
- 배치: `@nestjs/schedule` (관측 데이터 수집·매핑)
- DB: MySQL 8 (스키마 원본은 `../db/jellysafe_schema.sql`)

## 아키텍처

```
src/
├── shared/                      공통 인프라 (프레임워크/DB 어댑터, 커널)
│   ├── kernel/                  순수 도메인 공용: Id, DomainError, RiskLevel, Page
│   ├── persistence/
│   │   ├── prisma/              PrismaService (쓰기/트랜잭션)
│   │   └── kysely/              KyselyService + Prisma 스키마에서 생성한 DB 타입
│   ├── http/                    표준 응답 래퍼, 전역 예외 필터, 인터셉터
│   └── config/                  환경 설정 접근
└── contexts/                    바운디드 컨텍스트 (각자 헥사고날 전 계층)
    ├── report/                  제보/AI판별/검수 (USR-004/005, ADM-008/009, SYS-004) ★참조 구현
    ├── risk/                    위험도 룰 엔진/산출/조회/대시보드 (SYS-003, ADM-001/002/004/012)
    ├── beach/                   해변 마스터/목록/검색, 가이드/권고 마스터 (USR-001, G-006)
    ├── operation/               운영 대응 기록/상태 (ADM-006/007)
    ├── notification/            알림함/문구 생성 (SYS-005, ADM-010, USR-003)
    ├── observation/             관측 데이터 수집 배치/매핑 (SYS-001/002)
    ├── dailyreport/             일간 운영 리포트 (ADM-011, SYS-006)
    ├── favorite/                관심 해변 (USR-003)
    ├── user/                    인증/권한/감사 로그 (G-002, AUTH-001/002)
    └── secondary/               2차 확장 골격 (EX-001~004: 제휴/구독/ML/발송)
```

### 각 컨텍스트의 계층 (report 를 참조 표준으로)

```
<context>/
├── domain/                      순수 TS. 값 계약 enum, 애그리거트, 불변식·상태전이. (프레임워크/ORM 의존 없음)
├── application/
│   ├── port/in/                 유스케이스 인터페이스 + DI 심볼 토큰
│   ├── port/out/                리포지토리/쿼리/외부 포트 인터페이스 + 토큰
│   └── service/                 유스케이스 구현 (@Injectable, @Inject(토큰))
├── adapter/
│   ├── in/web/                  컨트롤러 + DTO(class-validator)
│   ├── in/schedule/             (observation) @Cron 배치
│   └── out/persistence/         *.prisma-repository.ts, *.kysely-query.ts, *.mapper.ts
└── <context>.module.ts          포트 ↔ 어댑터 DI 바인딩
```

**핵심 원칙**
- 도메인은 프레임워크/Prisma 를 모른다. 상태값은 소문자 union 타입(`'safe'|'caution'|...`)으로 계약하며 DB 의 `VARCHAR + CHECK + COLLATE utf8mb4_bin` 과 1:1 대응한다.
- 인바운드/아웃바운드 경계는 인터페이스(포트)로, 구현은 어댑터로. `Symbol` 토큰으로 DI 바인딩한다.
- 엔터티 Id 는 도메인에서 `number`, Prisma 에선 `bigint` — 매퍼가 경계에서 변환한다.
- 컨트롤러는 유스케이스 결과를 그대로 반환하고, 전역 인터셉터가 `{ success, data }` 로 감싼다. 예외는 `DomainError` 를 던지면 전역 필터가 HTTP 상태로 변환한다.

### 컨텍스트 간 연결
- `report` 는 검수 확인완료(ADM-009) 시 `risk` 의 위험도 재산출을 트리거한다. `report` 가 소유한 `RiskRecalcPort` 를 `risk` 의 `RiskRecalcAdapter` 가 구현하고, `RiskModule` 이 `RISK_RECALC` 토큰을 export → `ReportModule` 이 import 해서 연결된다.

## 실행

### 1. 사전 준비
```bash
cp .env.example .env          # DATABASE_URL 등 확인/수정
npm install
```

### 2. DB 스키마 적용
스키마 원본은 `../db/jellysafe_schema.sql` (ERwin/MySQL DDL). 이 파일을 MySQL 8 에 적용한다:
```bash
mysql -u<user> -p jellysafe < ../db/jellysafe_schema.sql
```
적용 후 Prisma 클라이언트/Kysely 타입을 생성한다(스키마 변경 시마다):
```bash
npm run prisma:generate
```
> Prisma 는 DB-first 로 운용한다. 운영 DB 와 대조하려면 `npm run prisma:pull` 로 `schema.prisma` 를 역생성해 비교할 수 있다.

### 3. 기동
```bash
npm run start:dev        # 개발(watch)
npm run start:prod       # 빌드 후 dist 실행
```
- API prefix: `/api`
- Swagger 문서: `http://localhost:3000/api/docs`

### 검증 스크립트
```bash
npm run typecheck        # tsc --noEmit (src + test + prisma + scripts)
npm run lint             # eslint (--max-warnings 0, 소스를 고치지 않는다)
npm run lint:fix         # 자동 수정
npm test                 # jest 단위 테스트 (DB 불필요)
npm run test:cov         # 단위 테스트 + 커버리지 기준선
npm run test:e2e         # 인가 경계 테스트 (DB 불필요)
npm run build            # nest build
```
CI(`.github/workflows/ci.yml`)가 위를 그대로 돌린다.

### 실 DB 스모크 (`npm run test:smoke`)

단위 테스트와 인가 e2e 는 DB 를 타지 않는다. SQL·제약·트랜잭션에서 나는 결함은 원리적으로
거기서 잡히지 않으므로(실제 사례: 다중 테이블 DELETE 제약 #28, 예보 저장이 CHECK 에 막히던 #22),
**진짜 MySQL 위에서** 주요 흐름이 끝까지 도는지 따로 본다.

```bash
npm run db:test:up       # 테스트용 MySQL 컨테이너 (3399 포트, tmpfs — 내리면 데이터 소멸)
npm run test:smoke       # 스키마 준비 + 시드 + 흐름 검증
npm run db:test:down     # 정리
```

검증 흐름: 기동·헬스체크 → 로그인 → 리프레시 토큰 회전/재사용 감지/로그아웃 → 인가 경계
(`/admin` 401, `/system` 401, operator 403) → 위험도 산출(`POST /system/risk/calculate`)과
공개 조회 → 제보 등록 → AI 판별 대기 → 관리자 검수.

스키마는 두 경로로 만든다. **로컬**은 스키마 원본(`../db/jellysafe_schema.sql`)을 그대로 적용해
CHECK 제약·콜레이션까지 운영과 같고, **CI** 는 그 파일이 저장소 밖이라 `prisma db push` 로 만든다
(테이블·인덱스·FK 는 같지만 CHECK 제약은 재현되지 않는다). 어느 경로로 돌았는지는 실행 로그에 찍힌다.
준비 스크립트는 시작할 때 테이블을 전부 지우므로, DB 이름에 `test` 가 없으면 실행을 거부한다.

## 주요 엔드포인트 (일부)

| 메서드 | 경로 | 기능 |
|---|---|---|
| POST | `/api/public/guest-tokens` | 비로그인 사용자 식별 토큰 발급 (앱 최초 1회) |
| POST | `/api/public/consents` | 개인정보 동의 기록 (PRIV-001) — 제보 전에 먼저 호출 |
| POST | `/api/public/reports/image` | 제보 사진 업로드 (서버 경유) |
| POST | `/api/public/reports/image/presign` | 제보 사진 업로드용 사전 서명 URL (S3 드라이버 전용) |
| POST | `/api/public/reports` | 해파리 제보 (USR-004) |
| GET | `/api/public/reports/:id` | 제보 결과/AI 안내 (USR-005) |
| GET | `/api/public/beaches` | 해변 목록/검색 + 현재 위험단계 (USR-001) |
| GET | `/api/public/beaches/:id/risk` | 해변 위험도 상세 (USR-002) |
| POST | `/api/public/favorites` | 관심 해변 저장 (USR-003) |
| GET | `/api/public/alerts` | 알림함 (USR-003) |
| GET | `/api/admin/dashboard/summary` | 대시보드 요약 (ADM-001) |
| GET | `/api/admin/risks/latest` | 지도/리스트 위험도 (ADM-002/003) |
| GET | `/api/admin/beaches/:id/risk` | 해변 위험도 상세 (ADM-004/005) |
| GET | `/api/admin/reports` | 제보 목록 (ADM-008) |
| PATCH | `/api/admin/reports/:id/review` | 제보 검수 → 위험도 재산출 (ADM-009) |
| POST | `/api/admin/operation-actions` | 운영 대응 기록 (ADM-007) |
| POST | `/api/admin/notifications/preview` | 알림 문구 생성 (ADM-010) |
| GET/POST | `/api/admin/daily-reports` | 일간 리포트 (ADM-011) |
| POST | `/api/system/risk/calculate` | 위험도 산출 (SYS-003, 내부/배치) |

## 인증 · 인가

경로 프리픽스가 곧 인증 정책이다. 전역 가드 셋이 각자 자기 경로만 검사한다.

| 경로 | 자격증명 | 가드 |
|---|---|---|
| `/public/*` | 없음(공개 조회) 또는 아래 "사용자 식별" | `JwtAuthGuard`(Bearer 가 있으면 검증) |
| `/admin/*` | `Authorization: Bearer <accessToken>` | `JwtAuthGuard`(필수) + `@Roles` |
| `/system/*` | `x-system-key: <SYSTEM_API_KEY>` | `SystemAuthGuard`(미설정 시 fail-closed) |

### 사용자 식별 (`/public/*` 중 개인 자료)

관심 해변·알림함·푸시 구독은 소유자가 있어야 한다. **신원은 자격증명에서만 나온다.**

- 로그인: `Authorization: Bearer <accessToken>` → `@CurrentUser` 의 `userId`
- 비로그인: `POST /public/guest-tokens` 가 발급한 `userToken`(46자, HMAC 서명)
  - 앱 최초 실행 때 한 번 발급받아 기기에 저장하고 이후 계속 같은 값을 보낸다.
  - 등록은 body 의 `userToken`, 조회/해제는 쿼리 `?token=`.

요청 본문·쿼리·헤더의 `userId`(`x-user-id` 포함)는 **받지 않는다.** 스키마에 없으므로 보내면 400 이고,
서버가 서명하지 않은 게스트 토큰은 401 이다. 자칭 신원으로 남의 자료에 닿을 수 없게 하기 위해서다
(관심 해변은 위험 알림의 발송 대상이라, 사칭이 곧 **타인의 안전 알림 무력화**가 된다).

이 경계는 `test/authz.e2e-spec.ts` 가 실제 HTTP 요청으로 지킨다(`npm run test:e2e`).

### 역할 (`/admin/*`)

**표시가 없으면 닫혀 있다.** `@Roles` 를 붙이지 않은 관리자 경로는 기본값 `operator|admin` 을
요구한다 — 데코레이터를 깜빡 잊은 컨트롤러가 열려 있는 것보다 닫혀 있는 편이 안전하다.

| 대상 | 허용 역할 |
|---|---|
| 제보·알림·해변·관측·위험도·일간리포트·운영 | `operator`, `admin` (기본값) |
| 계정 등록, 사용자 목록, 감사 로그 | `admin` |
| 2차 기능 골격(ML 모델·제휴사·구독) | `admin` |

### 세션 (액세스 토큰 · 리프레시 토큰)

| 엔드포인트 | 하는 일 |
|---|---|
| `POST /admin/auth/login` | `accessToken`(JWT) + `refreshToken` 발급 |
| `POST /admin/auth/refresh` | `refreshToken` 으로 새 `accessToken` + **새 `refreshToken`** 발급(회전) |
| `POST /admin/auth/logout` | 그 로그인에서 파생된 토큰 무효화(`allDevices: true` 면 계정 전체) |

- 재발급 때마다 토큰이 바뀐다. 클라이언트는 응답의 새 값으로 **반드시 덮어써야** 한다.
- 이미 쓴 토큰이 다시 오면 도난으로 보고 그 사슬 전체를 무효화한다(원래 사용자도 재로그인).
- 실패는 이유를 가리지 않고 401 `REFRESH_TOKEN_INVALID` 다. 존재 여부를 알려주지 않기 위해서다.
- ⚠️ **로그아웃은 이미 발급된 `accessToken` 을 취소하지 못한다.** JWT 는 서명만으로 검증되므로
  남은 수명(`JWT_EXPIRES`)까지 유효하다. 즉시성이 필요하면 `JWT_EXPIRES` 를 줄이는 수밖에 없다.
- 저장은 해시(SHA-256)만 한다. `refresh_tokens` 테이블은 `prisma/sql/002-refresh-tokens.sql` 로
  적용하며, **적용 전에도 앱은 뜬다**(로그인이 `refreshToken: null`, 재발급/로그아웃은 503).

## 운영에서 알아둘 설정

| 환경변수 | 기본값 | 왜 중요한가 |
|---|---|---|
| `JWT_SECRET` | (필수, 32자 이상) | 관리자 토큰 + 게스트 토큰 HMAC 의 원본. 회전하면 발급된 게스트 토큰이 전부 무효가 된다. |
| `RISK_RULE_VERSION` | `v1` (운영 `v3`) | `v1\|v2\|v3` 외의 값이면 **기동하지 않는다.** 오타는 조용한 v1 롤백이 되기 때문. |
| `MOCK_COLLECTOR_FALLBACK` | 운영 `false` / 그 외 `true` | 운영에서 켜면 외부 API 장애 시 **가짜 관측치·가짜 해파리 출현이 위험도로 들어간다.** |
| `SYSTEM_API_KEY` | 없음 | 미설정 시 `/system/*` 전면 차단(fail-closed). |
| `RISK_CALCULATION_STALE_MINUTES` | `30` | 부팅 시 이보다 오래 `running` 인 산출 배치를 실패로 확정한다(비정상 종료 잔재). |
| `JWT_EXPIRES` | `12h` | 서버가 취소할 수 없는 토큰의 수명 = 유출 시 최대 노출 시간. 재발급 흐름을 붙였으면 줄일 수 있다. |
| `REPORT_RETENTION_DAYS` | `90` | 제보 사진·위치 보관 기간(PRIV-003). 접수 시점에 행에 박히므로 **기존 제보에는 소급되지 않는다.** |
| `STORAGE_DRIVER` | `local` | `local` 은 **단일 머신 전용**(볼륨은 머신에 붙는다). 머신을 늘리기 전에 `s3` 로 바꾼다. 오타는 기동 실패. |
| `S3_PUBLIC_BASE_URL` | 없음 | 저장된 사진을 읽는 기준 URL. **DB 에 남는 값의 앞부분이라 한 번 정하면 바꾸지 않는다.** |
| `CONSENT_RETENTION_DAYS` | `365` | 동의 기록 보관 기간. 제보보다 길게 두는 것이 의도다(적법성 증명 자료가 먼저 사라지면 안 된다). |
| `REFRESH_TOKEN_EXPIRES_DAYS` | `14` (1~90) | 재로그인 없이 버티는 기간. `refresh_tokens` 테이블(`prisma/sql/002`)이 있어야 동작한다. |
| `OCCURRENCE_RETENTION_YEARS` | `6` | `PAST_OCCURRENCE` 가 과거 5년을 세므로 그보다 짧으면 **그 룰이 조용히 죽는다**(5로 클램프). |
| `DB_POOL_LIMIT` + `DATABASE_URL?connection_limit=` | `10` + Prisma 기본 | 커넥션 풀이 **두 개**다. DB 가 보는 접속 수는 합이며, 기동 로그에 둘 다 찍힌다. |

## 배치와 중복 실행

같은 배치로 들어오는 입구가 여럿이다. 전부 **하나의 게이트**(`shared/scheduling/job-gate.ts`)를 지난다.

| 배치 | 입구 |
|---|---|
| `observation-sync` | `OBSERVATION_SYNC_CRON` 크론 · `POST /system/observations/sync` |
| `risk-recalc-all` | `RISK_RECALC_CRON` 크론 · `POST /system/risk/calculate`(beachId 미지정) · 관측 배치의 재산출 |

겹치면 크론은 조용히 다음 주기를 기다리고, `/system/*` 수동 트리거는 **409** 를 준다
(조용히 넘기면 운영자는 눌렀는데 아무 일도 안 일어난 이유를 알 수 없다).
해변 1곳 재산출(`beachId` 지정)은 제보 검수가 부르는 경로라 게이트를 타지 않는다 — 스킵하면
검수는 끝났는데 위험도가 그대로인 상태가 된다.

게이트는 **인프로세스**다. 머신을 늘리면 분산 락으로 바꿔야 하고, 고칠 곳은 그 파일 하나다.

## DB 스키마 변경

DB-first 라 `prisma migrate` 를 운영에 쓰지 않는다. 인덱스 조정처럼 코드만으로 반영되지 않는
작업은 `prisma/sql/` 에 SQL 로 두고 운영자가 확인 후 적용한다.

```bash
mysql -h <host> -u <user> -p <db> < prisma/sql/001-index-cleanup.sql
npx prisma db pull        # 적용 후 schema.prisma 와 대조
```

## 후속 작업(TODO)

1. **이미지 업로드 파이프라인**: 현재는 로컬 볼륨(`UPLOAD_DIR`)에 저장한다. 다중 머신으로 확장하려면
   S3 등 오브젝트 스토리지로 옮겨야 한다(볼륨은 머신에 묶인다).
   파기 쪽은 이미 포트로 분리돼 있어 `REPORT_IMAGE_STORAGE` 어댑터만 교체하면 된다.
2. **수평 확장 준비**: 지금은 단일 머신 전제다. 머신을 늘리려면 세 곳을 **함께** 고쳐야 한다 —
   레이트 리밋 스토리지(인메모리 → Redis), 배치 중복 방지(`JobGate` → 분산 락),
   업로드 저장소(로컬 볼륨 → 오브젝트 스토리지).
3. **어댑터 계층 테스트**: Kysely 로 쓴 SQL(대시보드 집계, `is_latest` 트릭, 파기 배치의 보존 규칙)은
   아직 회귀 안전망이 없다. testcontainers 기반 통합 테스트가 비용 대비 효과가 가장 크다.
4. **2차 확장(`secondary/`)**: 제휴/구독/ML/발송 골격은 MVP 연동 대상이 아니며 테스트가 없다.
   실제로 쓸 때 유스케이스부터 다시 설계한다.
