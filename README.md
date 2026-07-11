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
npm run typecheck        # tsc --noEmit (전체 타입 검사)
npm run build            # nest build
```

## 주요 엔드포인트 (일부)

| 메서드 | 경로 | 기능 |
|---|---|---|
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

## 후속 작업(TODO)

MVP 골격은 완성돼 부팅·라우팅·DI 가 검증됐다. 다음은 통합/운영 전 보완 항목이다.

1. **인증/인가 가드**: 현재 관리자 식별은 `x-user-id` 헤더 임시 방식. `user` 컨텍스트의 로그인 위에 JWT/세션 가드 + `@CurrentUser` 데코레이터로 교체.
2. **자동 알림 트리거**: `risk`(단계 상승)·`report`(독성/쏘임 제보) 발생 시 `notification` 의 `CreateNotificationUseCase` 를 호출하도록 각 컨텍스트에 아웃바운드 포트를 추가 배선. (현재 알림 생성/조회 API 자체는 동작.)
3. **감사 로그 연결**: `report`/`operation` 검수·기록 시 `user` 의 `RecordAuditLogUseCase` 호출 배선 (AUTH-002).
4. **룰 시드**: `risk_rule_configs` 초기 점수표(`../db` 기준 03_Data_AI 값)와 `beaches`(협재/함덕/이호테우/중문/표선), `notification_templates`, `static_guides` 시드 스크립트.
5. **이미지 업로드**: 제보 사진은 현재 업로드 완료된 `imageUrl` 을 받는 전제. 실제 업로드(S3 등) 파이프라인 추가.
6. **PRIV-003 보관정책**: 제보 사진/위치정보 파기 스케줄 (`purge_scheduled_at`).
