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
    ├── groundtruth/             정답 데이터·예측 대조 (현장 관측/쏘임 사고/정확도)
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

npm run sql:check-constraints   # 값 계약 → CHECK 제약 DDL 재생성(도메인 enum 을 고쳤을 때)
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

스모크는 두 갈래다.

- `flow.smoke-spec.ts` — **배선이 이어져 있는가**를 HTTP 로 본다(아래 흐름).
- `persistence.smoke-spec.ts` — 그 아래 **SQL 이 실제로 맞는가**를 본다. Kysely 로 쓴 조회·집계에는
  단위 테스트가 없다(포트를 가짜로 바꾸면 SQL 이 아예 실행되지 않으므로 원리적으로 불가능하다).
  위험도 목록·필터·상세 카드·대시보드 집계, `is_latest` 가 해변마다 하나라는 불변식,
  CHECK 제약이 계약 밖 값을 실제로 거부하는지, 그리고 **분산 락이 서로 다른 세션을 막는지**를
  확인한다. 마지막 항목은 "머신 두 대" 를 흉내 내는 것이라 진짜 MySQL 없이는 만들 수 없다.

flow 검증 흐름: 기동·헬스체크 → 로그인 → 리프레시 토큰 회전/재사용 감지/로그아웃 → 인가 경계
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
| GET | `/api/public/notification-consents` | 내 알림 수신 상태(푸시 기기 수·문자 동의) |
| POST | `/api/public/notification-consents/sms` | 문자 수신 동의 (EX-002) |
| GET | `/api/admin/dashboard/summary` | 대시보드 요약 (ADM-001) |
| GET | `/api/admin/risks/latest` | 지도/리스트 위험도 (ADM-002/003) |
| GET | `/api/admin/beaches/:id/risk` | 해변 위험도 상세 (ADM-004/005) |
| GET | `/api/admin/reports` | 제보 목록 (ADM-008) |
| PATCH | `/api/admin/reports/:id/review` | 제보 검수 → 위험도 재산출 (ADM-009) |
| POST | `/api/admin/operation-actions` | 운영 대응 기록 (ADM-007) |
| POST | `/api/admin/notifications/preview` | 알림 문구 생성 (ADM-010) |
| GET/POST | `/api/admin/daily-reports` | 일간 리포트 (ADM-011) |
| POST | `/api/system/risk/calculate` | 위험도 산출 (SYS-003, 내부/배치) |
| GET | `/api/system/metrics` | 운영 지표 (Prometheus 형식, 신선도 감시) |
| POST | `/api/admin/field-observations` | 현장 관측 기록 (**부재도 기록**) |
| POST | `/api/admin/sting-incidents` | 쏘임 사고 기록 |
| GET | `/api/admin/accuracy` | 예측 정확도 (해변별 포함) |
| POST | `/api/system/evaluations/run` | 예측 대조 실행 (배치) |
| POST | `/api/admin/partners/:id/api-keys` | 제휴사 API 키 발급 (EX-001) |
| GET | `/api/partner/v1/beaches` | **제휴사용** 해변별 현재 위험도 (x-api-key) |
| GET | `/api/partner/v1/beaches/:id/risk` | **제휴사용** 해변 위험도 상세 (x-api-key) |
| PATCH | `/api/admin/subscriptions/:id/status` | 구독 상태 변경 (EX-004) — 활성 구독만 해역 알림을 받는다 |
| POST | `/api/admin/subscriptions/:id/areas` | 감시 해역 등록 (해변 또는 좌표+반경) |

## 인증 · 인가

경로 프리픽스가 곧 인증 정책이다. 전역 가드 셋이 각자 자기 경로만 검사한다.

| 경로 | 자격증명 | 가드 |
|---|---|---|
| `/public/*` | 없음(공개 조회) 또는 아래 "사용자 식별" | `JwtAuthGuard`(Bearer 가 있으면 검증) |
| `/admin/*` | `Authorization: Bearer <accessToken>` | `JwtAuthGuard`(필수) + `@Roles` |
| `/system/*` | `x-system-key: <SYSTEM_API_KEY>` | `SystemAuthGuard`(미설정 시 fail-closed) |
| `/partner/*` | `x-api-key: <제휴사 키>` | `PartnerAuthGuard`(키·범위·키별 호출 제한) |

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

### 제휴 API (`/partner/v1/*`, EX-001)

숙박·레저 플랫폼에 위험도를 제공하는 경로. `/public/*` 을 그대로 열지 않은 이유는 두 가지다 —
우리 화면 사정으로 응답을 바꿀 때마다 **남의 서비스가 깨지고**, 누가 얼마나 쓰는지 몰라 계약·
과금·차단의 단위가 없기 때문이다. 그래서 응답 스펙을 따로 고정하고 경로에 버전을 둔다.

- **키**: 관리자가 발급(`POST /admin/partners/:id/api-keys`). 원문은 **발급 응답에서만** 볼 수
  있고 서버는 해시만 저장한다. 잃어버리면 폐기 후 재발급이 유일한 방법이다.
- **범위(scope)**: 키에 담긴 범위만 호출된다. 엔드포인트에 범위 표시가 없으면 **가드가 거부**한다
  (표시를 잊은 경로가 열려 있는 것보다 닫혀 있는 편이 안전하다).
- **호출 제한**: 키 단위 분당 한도(기본 60). 전역 리밋은 IP 기준이라 제휴사를 구분하지 못한다.
- **호출 로그**: 모든 호출을 `partner_api_call_logs` 에 남긴다. 인증 실패(401/403)와 서버
  오류(5xx)는 **과금하지 않는다** — 앞은 서비스를 쓴 것이 아니고, 뒤는 우리 잘못이다.

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
  남은 수명(`JWT_EXPIRES`)까지 유효하다. 그래서 기본값을 **30분**으로 두고, 운영에서는 2시간을
  넘기는 값이면 **기동을 막는다**(재발급 흐름이 있으므로 짧게 두는 데 드는 비용이 없다).
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
| `JWT_EXPIRES` | `30m` (운영 상한 2h) | 서버가 취소할 수 없는 토큰의 수명 = **유출 시 최대 노출 시간**. 형식이 틀리거나(`30` → 30밀리초) 운영에서 상한을 넘으면 기동하지 않는다. |
| `JOB_LOCK_DRIVER` | `mysql` | 배치 중복 실행을 막는 락. `memory` 는 **머신이 하나일 때만** 맞다. 아래 "배치와 중복 실행" 참고. |
| `KAKAO_SERVICE_ID` · `KAKAO_CHANNEL_ID` · `KAKAO_TEMPLATE_CODES` | 없음 | 알림톡. 문자와 **따로 켠다**(카카오 채널 + 템플릿 심사가 더 필요하다). 승인 템플릿 없이 켜면 전부 거부된다. |
| `PUBLIC_CACHE_TTL_SECONDS` | `30` | 공개 조회 캐시. **0 이면 끈다.** 신선도는 TTL 이 아니라 산출 후 무효화가 지킨다 — 제보 검수로 재산출되면 즉시 비워져 시민은 바로 새 값을 본다. |
| `RATE_LIMIT_DEFAULT_PER_MIN` | `300` | 급증 때 **재배포 없이** 올릴 수 있어야 하는 값. 정상 사용자가 429 를 받기 시작하면 여기를 본다. |
| `PREDICTION_EVALUATION_CRON` | `0 0 4 * * *` | 예측 대조. 자정 직후면 늦게 들어오는 현장 기록이 빠져 오경보로 잘못 세어진다. |
| `SECONDARY_ENABLED` | `true` | 2차 기능(제휴 API·구독·모델 관리). `false` 면 `/partner/v1/*` 은 **키를 보기도 전에** 404, `/admin/*` 2차 경로는 인증을 통과한 사람에게 404 다. 제휴사가 없으면 별도 자격증명으로 들어오는 문을 열어 둘 이유가 없다. |
| `REPORT_RETENTION_DAYS` | `90` | 제보 사진·위치 보관 기간(PRIV-003). 접수 시점에 행에 박히므로 **기존 제보에는 소급되지 않는다.** |
| `SMS_PROVIDER` | `none` | 문자 발송 사업자. 기본은 꺼짐 — 건당 과금 + 발신번호 사전등록이 필요한 채널이라 켤 때만 켠다. |
| `SMS_MIN_RISK_LEVEL` | `danger` | 문자를 보내는 최소 위험 단계. 낮추면 비용·알림 피로가 늘고 위험 단계 문자가 묻힌다. |
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

게이트가 실제로 문을 잠그는 방식은 `JOB_LOCK_DRIVER` 가 정한다.

| 값 | 판정 범위 | 언제 |
|---|---|---|
| `mysql` (기본) | 인스턴스 전체 | 항상 맞다. MySQL 사용자 락(`GET_LOCK`)을 쓴다. |
| `memory` | 프로세스 안 | 머신이 하나일 때만. |

**기본값이 `mysql` 인 이유**: 인프로세스 락은 "머신이 하나" 라는 전제 위에서만 맞는데, 그 전제가
깨지는 순간(`fly scale count 2`) 게이트가 **조용히 사라진다.** 크론이 양쪽에서 동시에 돌아도
로그에는 각자 정상으로 찍히고, 증상은 `risk_scores` 중복·트랜잭션 경합처럼 배치와 멀어 보이는
형태로 나타난다. MySQL 락은 머신이 하나일 때도 동작이 같으므로(한 번 더 확인할 뿐이다),
맞는 쪽을 기본값으로 두었다.

Redis 가 아니라 MySQL 을 쓴 이유는 **의존 대상을 늘리지 않기 위해서**다 — 배치는 어차피 MySQL
없이는 아무 일도 못 한다. 테이블 락이 아니라 `GET_LOCK` 인 이유는 그것이 **세션에 묶여 있어서**,
프로세스가 죽거나 배포로 컨테이너가 사라지면 서버가 알아서 풀기 때문이다(만료 시각을 추정할
필요가 없다). 대가는 배치가 도는 동안 커넥션 하나를 붙잡는 것이다.

## DB 스키마 변경

DB-first 라 `prisma migrate` 를 운영에 쓰지 않는다. 인덱스 조정처럼 코드만으로 반영되지 않는
작업은 `prisma/sql/` 에 SQL 로 두고 운영자가 확인 후 적용한다.

```bash
mysql -h <host> -u <user> -p <db> < prisma/sql/001-index-cleanup.sql
npx prisma db pull        # 적용 후 schema.prisma 와 대조
```

### 값 계약 CHECK 제약 (`prisma/sql/003`)

상태값은 도메인에서 소문자 union 으로, DB 에서 `VARCHAR + CHECK` 로 **같은 목록을 두 번** 표현한다.
두 목록은 조용히 어긋나고, 실제로 그 어긋남이 사고가 된 적이 있다(#22 — 예보 저장이 CHECK 에
막혀 한 건도 안 들어가던 문제). 게다가 그 결함은 CI 에서 잡히지 않았다. 스키마 원본이 저장소
밖이라 CI 는 `prisma db push` 로 테이블을 만드는데, **그 경로에는 CHECK 가 없기 때문**이다.

그래서 목록을 손으로 두 번 적지 않는다. 도메인 enum 을 원본으로 삼아 DDL 을 생성한다:

```
도메인 enum  →  prisma/value-contracts.ts  →  prisma/sql/003-check-constraints.sql
```

enum 을 고쳤으면 `npm run sql:check-constraints` 로 다시 만든다. 안 만들면 CI 가 잡는다
(`prisma/value-contracts.spec.ts` 가 커밋된 파일과 표를 대조한다). 제약이 진짜 DB 에 걸렸는지는
스모크(`test/persistence.smoke-spec.ts`)가 확인한다.

## 운영 지표 (`GET /system/metrics`)

이 서비스의 가장 나쁜 실패는 **"멎었는데 멀쩡해 보이는" 상태**다. 위험도 산출 배치가 어젯밤부터
안 돌아도 API 는 200 을 주고, 화면에는 어제 값이 오늘 값인 양 뜬다. 헬스체크도 초록이다 —
프로세스도 DB 도 멀쩡하기 때문이다.

수집 쪽 고장은 `sync-health` 가 이미 본다(NIFS PDF 양식이 바뀌어 조용히 0건이 되는 것까지).
하지만 그건 **입력**만 본다. 입력이 멀쩡해도 산출이 멎으면 결과는 그대로 낡는다.

```bash
curl -H "x-system-key: $SYSTEM_API_KEY" https://<host>/api/system/metrics
```

| 지표 | 의미 |
|---|---|
| `jellysafe_risk_calculation_age_seconds` | 마지막 산출 성공 이후 경과. **계속 커지면 배치가 멎었다.** |
| `jellysafe_oldest_risk_score_age_seconds` | 노출 중인 위험도 중 **가장 오래된** 것의 나이(평균이 아니다 — 해변 한 곳만 밀려도 그곳 이용자에겐 전부 낡은 정보다). |
| `jellysafe_sync_sources{health=...}` | 수집 소스 상태별 개수. |
| `jellysafe_pending_vision_results` | AI 판별 대기. 쌓이면 판별이 멎은 것이다. |
| `jellysafe_unreviewed_reports` | 검수 대기 제보. 운영자 처리량이 유입을 따라가는지. |

값이 없을 때는 `-1` 이다 — 0 으로 접으면 "한 번도 성공한 적 없음" 과 "방금 성공" 이 같은 값이 되어
경보가 정확히 반대로 뒤집힌다. 경과 **시각**이 아니라 **나이**를 내보내는 것도 같은 이유다(수집기와
서버의 시계가 어긋나도 규칙이 흔들리지 않는다).

Prometheus 노출 형식이라 Grafana Agent·Prometheus 가 그대로 읽는다. 이 경로만 공통 응답
포맷(`{success, data}`)을 쓰지 않는다 — 수집기가 읽는 규격이라서다.

## 오류 추적 (요청 상관관계 ID)

`"아까 제보하는데 오류가 났어요"` 라는 신고를 추적 가능한 것으로 바꾸기 위한 장치다. 예전에는
로그에 `POST /public/reports -> 500` 한 줄만 남았고, 성수기에 분당 수백 건이 들어오는 경로에서
그 사람의 요청이 어느 줄인지 고를 방법이 없었다.

- 요청마다 ID 를 붙여 응답 헤더 `x-request-id` 로 돌려준다.
- **실패 응답 본문에도** 넣는다 — 화면이 사용자에게 보여줄 수 있도록.
- 그 요청에서 나온 로그에 같은 값이 찍힌다.

```json
{ "success": false, "error": { "code": "INTERNAL_ERROR", "message": "..." },
  "requestId": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0" }
```

클라이언트가 보낸 `x-request-id` 가 얌전한 값이면(영숫자·하이픈·밑줄, 128자 이하) **이어받는다** —
프론트엔드가 이미 붙인 ID 가 있으면 양쪽 로그가 하나로 이어져야 하기 때문이다. 모양이 어긋나면
버리고 새로 만든다. 로그에 그대로 찍히는 클라이언트 입력이라, 개행 한 줄이면 가짜 로그 줄을
만들어 낼 수 있기 때문이다(로그 위조).

가드보다 **먼저** 도는 미들웨어라 인증 실패(401)·레이트 리밋(429)처럼 컨트롤러에 닿지도 못한
요청에도 ID 가 남는다 — 그런 요청이야말로 추적이 필요하다.

## 정답 데이터와 예측 대조 (groundtruth)

이 서비스는 오랫동안 **자기가 맞았는지 알 수 없는 구조**였다. 위험도는 `해변 × 시점` 으로
내는데 검증에 쓴 정답은 `시군구 × 주` 였다(`docs/backtest.md` 가 그 한계를 직접 적어 두었다).
화면이 "협재 / 함덕" 을 구분해 보여주는데 **그 구분이 맞는지 확인된 적이 없었다.**

| 입력 | 무엇인가 |
|---|---|
| `POST /admin/field-observations` | 현장 관측. **해파리를 못 봤을 때도 기록한다** |
| `POST /admin/sting-incidents` | 쏘임 사고. 가장 강한 정답 |
| `GET /admin/accuracy` | 대조 결과 — 특히 **해변별** |

### 부재 관측이 왜 중요한가

시민 제보는 **본 사람만** 올린다. 그래서 "제보 없음" 이 "해파리 없음" 을 뜻하지 않고,
그 데이터로는 **오경보를 셀 수 없다.** 경보했는데 실제로 안전했는지 확인할 방법이 없기 때문이다.
현장 관측은 정해진 사람이 정해진 시각에 있었다/없었다를 **모두** 남긴다 — 그 절반이 없으면
이 서비스는 영원히 자기 오경보율을 모른다.

그래서 도메인이 불변식으로 강제한다. 없었다면서 밀도를 적을 수 없고, 있었다면서 밀도를
비울 수 없다 — 둘 다 나중에 집계에서 조용히 잘못 세어지는 형태다.

### 지표를 읽는 법

**지표 하나로 품질을 말할 수 없다.** 항상 경보하면 재현율은 1 이지만 오경보율도 1 이고,
절대 경보하지 않으면 오경보율은 0 이지만 재현율도 0 이다.

- `recall` — 위험했던 날 중 경보한 비율. **1 에서 이 값을 뺀 것이 놓친 비율**이다.
- `precision` — 경보한 날 중 실제로 위험했던 비율. 낮으면 경보가 무시당하기 시작한다.
- `falseAlarmRate` — 안전했던 날 중 경보한 비율. 알림 피로의 직접 지표다.

분모가 0 이면 **null 이다**(0 이 아니다). 데이터가 없는 초기에 지표가 좋아 보이는 착시를 막는다.

판정 단위는 **해변 × 하루**다. 시점 단위로 맞추지 않는 것은 정답이 그 해상도를 감당하지
못하기 때문이다(관측은 하루 두세 번, 사고 시각은 신고 시각이라 부정확하다).
같은 (해변, 날짜)를 다시 평가하면 덮어쓴다 — 119 연계처럼 늦게 들어오는 기록을 흡수하기 위해서다.

## 위험 단계 표기

`safe` 의 표기는 **'안전' 이 아니라 '낮음'** 이다. '안전' 은 쏘이지 않는다는 보장으로 읽히는데,
해파리는 확률적으로 나타나므로 우리가 할 수 없는 약속이다. 실제로 이 서비스는 "낮다고 했는데
사고가 난" 경우를 센다(위 `miss`).

아직 산출한 적이 없는 해변은 `riskLevel` 이 `safe` 라도 표기가 **'정보 없음'** 이다 —
"낮다" 와 "모른다" 는 다른 말이고, 그 둘을 섞는 것이 안전 서비스에서 가장 나쁜 응답이다.

라벨은 서버가 정해 `riskLevelLabel` 로 내려준다. 앱·문자·제휴사가 **같은 단계를 같은 말로**
불러야 하기 때문이다(각자 번역하면 조용히 달라진다).

## 알림 도달

| 채널 | 닿는 곳 | 비고 |
|---|---|---|
| 웹 푸시 | Android·데스크톱 | iOS 는 홈 화면 설치를 요구해 실질 도달률이 낮다 |
| **카카오 알림톡** | 카카오톡 사용자 | 앱 설치 불필요. iOS 구멍을 메우는 채널 |
| 문자 | 전부 | 건당 과금. 알림톡이 닿지 않을 때의 대체 |

같은 수신 동의(전화번호)에 대해 **알림톡 → 문자** 순으로 가고, 접수되면 두 번 보내지 않는다.
알림톡 실패 시 문자로 넘길지는 갈라서 판정한다 — 도달 불가(미가입·차단)는 넘기고,
템플릿 형식 위반은 넘기지 않는다(문자로 보내면 문구가 어긋난 사실이 가려진다).

사업자 자동 대체발송은 쓰지 않는다. 무엇이 실제로 나갔는지 이력에 남지 않아 **도달률도 비용도
셀 수 없게** 되기 때문이다.

⚠️ 알림톡은 **자유 문구를 보낼 수 없다.** 승인 템플릿을 등록할 때 문구 생성기가 만드는 형태
그대로 받아야 하고, 문구를 바꾸면 재승인 전까지 발송이 거부된다.

## 부하

첫 실측 기준선은 `docs/load-test.md` 에 있다(`npm run load:test`).

| 동시 | 처리량 | p95 | 실패 |
|---|---|---|---|
| 20 | 555 req/s | 77ms | 0 |
| 100 | 601 req/s | **423ms** | 0 |

동시성을 5배 올렸는데 처리량은 8% 늘고 지연만 5.5배가 됐다 — **이미 천장(≈570 req/s)에
닿았다는 신호**다. 실패가 0 인 것은 좋은 신호다(포화에서 죽지 않고 느려지기만 했다).

### 병목을 갈라 보니 DB 였다

경로별로 따로 재면 어디가 느린지 나온다.

| 경로 | 처리량 | 무엇을 하는가 |
|---|---|---|
| `/api/health` | **2,453 req/s** | DB 를 타지 않는다 |
| `/api/public/beaches` | 804 req/s | 목록 + 최신 위험도 집계 |
| `/api/public/beaches/:id/risk` | 362 req/s | 지평별 카드 + 원인 태그 |

**프레임워크는 2,453 을 내는데 DB 질의가 3~7배를 깎는다.** Node 단일 프로세스가 아니라
DB 왕복이 병목이라는 뜻이고, 그래서 캐시가 듣는다.

### 캐시를 넣고 다시 쟀다

| 동시 | 캐시 전 | 캐시 후 |
|---|---|---|
| 20 | 555 req/s, p95 77ms | **1,866 req/s, p95 21ms** |
| 100 | 601 req/s, p95 423ms | **1,853 req/s, p95 80ms** |

3배 남짓 올랐다. 이제 천장이 서버가 아니라 **부하 생성기**(단일 Node 프로세스)로 보인다.

⚠️ 노트북 컨테이너 기준이라 **상한으로 읽어야 한다.** 운영은 `shared-cpu-1x/512MB` 로 더 약하고
관리형 MySQL 은 다른 리전에 있다.

## 후속 작업(TODO)

1. **수평 확장**: 남은 것은 **레이트 리밋 스토리지**(인메모리 → Redis) 하나다.
   배치 중복 방지는 분산 락으로 해결됐고(`JOB_LOCK_DRIVER=mysql`), 업로드 저장소는
   `STORAGE_DRIVER=s3` 로 전환할 수 있다. 레이트 리밋은 머신이 둘이면 실효 한도가 두 배가
   되지만 **기능이 깨지지는 않아** 우선순위가 가장 낮다(배치 중복 실행과 달리 데이터가
   틀어지지 않는다). 늘릴 때 함께 볼 것: 비 root 컨테이너 + 영구 볼륨의 소유권(Dockerfile 주석).
2. **어댑터 계층 테스트 확대**: `test/persistence.smoke-spec.ts` 가 위험도 조회·대시보드 집계·
   `is_latest` 불변식·CHECK 제약·분산 락을 실 DB 에서 본다. 아직 안 덮인 것은 **파기 배치의
   보존 규칙**(제보·알림·관측·위험도 이력)이다. 다중 테이블 DELETE 제약(#28)이 났던 자리라
   다음 순번으로 적당하다.
3. **운영 사양에서 다시 잰다**: 위 수치는 노트북 상한이다. `shared-cpu-1x/512MB` + 다른
   리전의 관리형 MySQL 에서는 왕복 지연이 더 붙으므로 **캐시 효과는 오히려 더 클 수 있다.**
   증설 시점을 정하려면 그 환경의 숫자가 필요하다. 부하 생성기도 여러 프로세스로 나눠야 한다.
4. **정답 데이터를 실제로 모은다**: 코드는 준비됐지만 **기관 협의가 남았다.** 안전요원 정기
   관측 운영 절차와 119·해경 사고 데이터 연계가 없으면 이 루프는 빈 채로 돈다. 대국민 서비스로
   가는 길에서 리드타임이 가장 긴 항목이다.
5. **하지 않은 것과 그 이유**: FCM(네이티브 앱이 없어 보낼 대상이 없다), 해역별 룰 파라미터
   (전국 확장 전에는 근거가 없다), 다국어. 재난문자(CBS)는 코드가 아니라 **행안부 권한** 문제다.
4. **2차 확장(`secondary/`)**: 제휴 API 는 실동작하며 인증 가드까지 테스트가 있다(EX-001).
   구독·모델 관리는 유스케이스는 돌지만 검증이 얇다. 안 쓰는 환경에서는 `SECONDARY_ENABLED=false`
   로 네 경로를 한꺼번에 닫아 둘 수 있다.
