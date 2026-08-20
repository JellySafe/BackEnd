/**
 * 값 계약 ↔ DB CHECK 제약의 **단일 원본**.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 이 프로젝트의 상태값은 소문자 union 타입으로 계약하고, DB 는 같은 값 집합을
 * `VARCHAR + CHECK` 로 못 박는다. 두 곳에 같은 목록이 있다는 뜻이고, **둘은 조용히 어긋난다.**
 *
 * 실제로 그 어긋남이 사고로 이어진 적이 있다(#22 — 예보 저장이 CHECK 에 막혀 한 건도 안
 * 들어가던 문제). 그리고 그 결함은 CI 에서 잡히지 않았다. 스키마 원본(`../db/jellysafe_schema.sql`)이
 * 저장소 밖이라 CI 는 `prisma db push` 로 테이블을 만드는데, 그 경로에는 **CHECK 제약이 없기
 * 때문**이다. 즉 CI 는 제약이 없는 DB 위에서 초록이었다.
 *
 * ── 어떻게 막는가 ────────────────────────────────────────────────────────────────────
 * 목록을 손으로 두 번 적지 않는다. 도메인 enum 배열을 그대로 가져와 여기서 한 번 엮고,
 * DDL 은 **거기서 생성한다**(`buildCheckConstraintSql`).
 *
 *   도메인 enum (원본)  →  CONTRACTS  →  prisma/sql/003-check-constraints.sql
 *
 * 커밋된 SQL 파일이 이 표에서 생성한 것과 다르면 테스트가 잡는다(value-contracts.spec.ts).
 * 그래서 "enum 은 고쳤는데 DDL 을 안 고친" 상태로는 CI 를 통과할 수 없다.
 *
 * ── 여기가 prisma/ 인 이유 ───────────────────────────────────────────────────────────
 * 이 표는 모든 컨텍스트의 값 계약을 한꺼번에 안다. `src/shared` 는 `src/contexts` 를 참조하지
 * 않는다는 규칙이 있으므로 거기 둘 수 없고, 특정 컨텍스트의 소유물도 아니다.
 * 스키마 수준 산출물이라 seed.ts 와 같은 자리(prisma/)가 맞다.
 */
import { GUIDE_TARGET_TYPES } from '@contexts/beach/domain/beach-enums';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_TARGETS,
} from '@contexts/notification/domain/notification-enums';
import {
  DISPATCH_CHANNELS,
  DISPATCH_STATUSES,
} from '@contexts/notification/application/port/out/notification-dispatch-repository.port';
import {
  ALERT_LEVELS,
  DENSITY_LEVELS,
  QUALITY_FLAGS,
  SOURCE_TYPES,
  STATION_TYPES,
  SYNC_STATUSES,
} from '@contexts/observation/domain/observation-enums';
import { OPERATION_STATUSES } from '@contexts/operation/domain/operation-enums';
import {
  AI_RESULTS,
  CONSENT_TYPES,
  REJECT_REASONS,
  REPORT_STATUSES,
  REPORT_TYPES,
  REVIEW_STATUSES,
  VISION_STATUSES,
} from '@contexts/report/domain/report-enums';
import { CALC_STATUSES, RULE_CATEGORIES, TRIGGER_TYPES } from '@contexts/risk/domain/risk-enums';
import { MODEL_STATUSES } from '@contexts/secondary/mlmodel/domain/ml-model';
import { PARTNER_STATUSES } from '@contexts/secondary/partner/domain/partner';
import { PAYMENT_STATUSES } from '@contexts/secondary/subscription/domain/subscription-lifecycle';
import {
  SUBSCRIBER_TYPES,
  SUBSCRIPTION_STATUSES,
} from '@contexts/secondary/subscription/domain/subscription';
import { TOXICITY_LEVELS } from '@contexts/species/domain/species-enums';
import { USER_ROLES } from '@contexts/user/domain/user-enums';
import { DATA_CONFIDENCES, RISK_HORIZONS, RISK_LEVELS } from '@shared/kernel/risk-level';

/** 테이블 한 컬럼이 가질 수 있는 값 집합. */
export interface ValueContract {
  table: string;
  column: string;
  /** 허용 값. 도메인 enum 배열을 그대로 넘긴다 — 여기서 새로 적지 않는다. */
  values: readonly string[];
  /** 이 계약이 지키는 것을 한 줄로. 생성된 SQL 에 주석으로 들어간다. */
  note: string;
}

/**
 * 값 계약 전체 목록.
 *
 * NULL 은 따로 허용할 필요가 없다 — SQL 에서 `NULL IN (...)` 은 참도 거짓도 아닌 UNKNOWN 이고,
 * CHECK 는 **거짓일 때만** 막는다. 즉 nullable 컬럼은 자동으로 NULL 을 통과시킨다.
 */
export const CONTRACTS: readonly ValueContract[] = [
  // ── user ──────────────────────────────────────────────────────────────────────────
  {
    table: 'users',
    column: 'role',
    values: USER_ROLES,
    note: '역할이 곧 인가 판정의 입력이다. 목록에 없는 값은 어느 가드도 통과시키지 않아야 한다.',
  },

  // ── beach ─────────────────────────────────────────────────────────────────────────
  {
    table: 'static_guides',
    column: 'target_type',
    values: GUIDE_TARGET_TYPES,
    note: '안내 문구 노출 대상.',
  },
  { table: 'static_guides', column: 'risk_level', values: RISK_LEVELS, note: '단계별 안내 문구.' },
  {
    table: 'risk_recommendations',
    column: 'risk_level',
    values: RISK_LEVELS,
    note: '단계별 운영 권고.',
  },

  // ── species ───────────────────────────────────────────────────────────────────────
  {
    table: 'jellyfish_species',
    column: 'toxicity',
    values: TOXICITY_LEVELS,
    note: '국립수산과학원 등급 체계. 미공표 종은 NULL — 추정해서 채우지 않는다.',
  },

  // ── observation ───────────────────────────────────────────────────────────────────
  { table: 'data_sources', column: 'source_type', values: SOURCE_TYPES, note: '수집 대상 구분.' },
  {
    table: 'data_sources',
    column: 'last_sync_status',
    values: SYNC_STATUSES,
    note: '마지막 수집 결과. 운영자가 배치 상태를 읽는 값이다.',
  },
  {
    table: 'observation_stations',
    column: 'station_type',
    values: STATION_TYPES,
    note: '관측소 종류.',
  },
  {
    table: 'observations',
    column: 'quality_flag',
    values: QUALITY_FLAGS,
    note: '결측·이상치 표시. 위험도 산출이 이 값으로 관측치를 걸러낸다.',
  },
  {
    table: 'observation_mappings',
    column: 'station_type',
    values: STATION_TYPES,
    note: '해변↔관측소 매핑 종류.',
  },
  {
    table: 'jellyfish_occurrences',
    column: 'density_level',
    values: DENSITY_LEVELS,
    note: 'v3 위험도의 축. 이 값이 어긋나면 인근 출현 점수가 통째로 빗나간다.',
  },
  {
    table: 'jellyfish_occurrences',
    column: 'alert_level',
    values: ALERT_LEVELS,
    note: 'NIFS 주의보 단계.',
  },

  // ── report ────────────────────────────────────────────────────────────────────────
  {
    table: 'consent_logs',
    column: 'consent_type',
    values: CONSENT_TYPES,
    note: '개인정보 동의 종류(PRIV-001).',
  },
  {
    table: 'jellyfish_reports',
    column: 'report_type',
    values: REPORT_TYPES,
    note: '제보 유형. 위험도 가중치가 여기서 갈린다.',
  },
  {
    table: 'jellyfish_reports',
    column: 'status',
    values: REPORT_STATUSES,
    note: '제보 상태 전이. 목록 밖 값은 검수 화면에서 어느 칸에도 잡히지 않는다.',
  },
  { table: 'jellyfish_reports', column: 'ai_result', values: AI_RESULTS, note: 'AI 판별 결과.' },
  {
    table: 'vision_results',
    column: 'process_status',
    values: VISION_STATUSES,
    note: 'AI 판별 처리 상태.',
  },
  { table: 'report_reviews', column: 'review_status', values: REVIEW_STATUSES, note: '검수 결과.' },
  { table: 'report_reviews', column: 'reject_reason', values: REJECT_REASONS, note: '반려 사유.' },

  // ── risk ──────────────────────────────────────────────────────────────────────────
  { table: 'risk_rule_configs', column: 'rule_category', values: RULE_CATEGORIES, note: '룰 종류.' },
  {
    table: 'risk_rule_configs',
    column: 'min_risk_level',
    values: RISK_LEVELS,
    note: '최소 단계 보장(RISK-002)이 끌어올릴 단계.',
  },
  {
    table: 'risk_calculations',
    column: 'trigger_type',
    values: TRIGGER_TYPES,
    note: '산출을 부른 입구.',
  },
  {
    table: 'risk_calculations',
    column: 'calc_status',
    values: CALC_STATUSES,
    note: '산출 배치 상태. 부팅 시 고아 정리가 이 값을 본다.',
  },
  {
    table: 'risk_scores',
    column: 'horizon',
    values: RISK_HORIZONS,
    note: '예측 지평. 오타가 들어가면 그 행은 어느 조회에도 잡히지 않고 조용히 쌓인다.',
  },
  {
    table: 'risk_scores',
    column: 'risk_level',
    values: RISK_LEVELS,
    note: '시민에게 보여주는 위험 단계. 이 컬럼이 이 서비스의 결론이다.',
  },
  {
    table: 'risk_scores',
    column: 'base_risk_level',
    values: RISK_LEVELS,
    note: '최소 단계 보장 적용 전 단계.',
  },
  {
    table: 'risk_scores',
    column: 'data_confidence',
    values: DATA_CONFIDENCES,
    note: '데이터 신뢰도(RISK-005).',
  },

  // ── operation ─────────────────────────────────────────────────────────────────────
  {
    table: 'operation_actions',
    column: 'operation_status',
    values: OPERATION_STATUSES,
    note: '운영 대응 상태(ADM-007).',
  },
  {
    table: 'operation_status_logs',
    column: 'previous_status',
    values: OPERATION_STATUSES,
    note: '운영 상태 변경 이력(이전).',
  },
  {
    table: 'operation_status_logs',
    column: 'new_status',
    values: OPERATION_STATUSES,
    note: '운영 상태 변경 이력(이후).',
  },

  // ── notification ──────────────────────────────────────────────────────────────────
  {
    table: 'notification_templates',
    column: 'target_type',
    values: NOTIFICATION_TARGETS,
    note: '문구 대상.',
  },
  {
    table: 'notification_templates',
    column: 'risk_level',
    values: RISK_LEVELS,
    note: '단계별 문구.',
  },
  {
    table: 'notification_templates',
    column: 'event_type',
    values: NOTIFICATION_EVENTS,
    note: '문구를 고르는 사건 종류.',
  },
  {
    table: 'notifications',
    column: 'target_type',
    values: NOTIFICATION_TARGETS,
    note: '알림 수신 대상.',
  },
  { table: 'notifications', column: 'risk_level', values: RISK_LEVELS, note: '알림이 알리는 단계.' },
  {
    table: 'notifications',
    column: 'event_type',
    values: NOTIFICATION_EVENTS,
    note: '알림을 만든 사건.',
  },
  {
    table: 'notification_consents',
    column: 'channel',
    values: DISPATCH_CHANNELS,
    note: '수신 동의 채널.',
  },
  {
    table: 'notification_dispatches',
    column: 'channel',
    values: DISPATCH_CHANNELS,
    note: '실제 발송 채널.',
  },
  {
    table: 'notification_dispatches',
    column: 'dispatch_status',
    values: DISPATCH_STATUSES,
    note: '발송 결과. 문자 과금 집계가 이 값을 센다.',
  },

  // ── dailyreport ───────────────────────────────────────────────────────────────────
  {
    table: 'daily_reports',
    column: 'max_risk_level',
    values: RISK_LEVELS,
    note: '그날의 최고 위험 단계.',
  },

  // ── secondary (EX-001~004) ────────────────────────────────────────────────────────
  {
    table: 'partners',
    column: 'partner_status',
    values: PARTNER_STATUSES,
    note: '제휴사 상태. 정지된 제휴사의 키는 통하지 않아야 한다.',
  },
  {
    table: 'ml_models',
    column: 'model_status',
    values: MODEL_STATUSES,
    note: '모델 생애 상태. 한 용도에 active 는 하나다.',
  },
  {
    table: 'subscriptions',
    column: 'subscriber_type',
    values: SUBSCRIBER_TYPES,
    note: '구독자 구분(어민/양식장).',
  },
  {
    table: 'subscriptions',
    column: 'subscription_status',
    values: SUBSCRIPTION_STATUSES,
    note: '활성 구독만 해역 알림을 받는다.',
  },
  {
    table: 'subscriptions',
    column: 'payment_status',
    values: PAYMENT_STATUSES,
    note: '결제 상태.',
  },
];

/** MySQL 제약 이름. 스키마 안에서 유일해야 한다. */
export function constraintName(contract: ValueContract): string {
  return `ck_${contract.table}_${contract.column}`;
}

/** 값 목록을 SQL 리터럴로. 값은 전부 코드 상수라 따옴표만 escape 하면 충분하다. */
function toSqlList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
}

/** 생성물의 첫 줄. 손으로 고치는 것을 막기 위해 파일 맨 위에 박아 둔다. */
export const GENERATED_MARKER = '-- 이 파일은 prisma/value-contracts.ts 에서 생성된다. 손으로 고치지 않는다.';

/**
 * 커밋되는 DDL 을 만든다.
 *
 * `ADD CONSTRAINT` 는 **이미 같은 이름이 있으면 실패한다.** 그건 문제가 아니라 스키마 원본
 * DDL 로 만든 DB(로컬)에는 제약이 이미 있다는 뜻이다. 그래서 준비 스크립트가 이 파일을
 * tolerateErrors 로 적용한다(scripts/prepare-test-db.ts).
 */
export function buildCheckConstraintSql(): string {
  const lines: string[] = [
    '-- =====================================================================================',
    '--  값 계약 CHECK 제약',
    '--',
    GENERATED_MARKER,
    '--     원본: prisma/value-contracts.ts (도메인 enum 배열을 그대로 엮은 표)',
    '--     생성: npm run sql:check-constraints',
    '--     검증: prisma/value-contracts.spec.ts 가 이 파일과 표가 일치하는지 본다.',
    '--',
    '--  왜 필요한가:',
    '--    스키마 원본(../db/jellysafe_schema.sql)은 저장소 밖이라 CI 는 `prisma db push` 로',
    '--    테이블을 만든다. 그 경로에는 CHECK 제약이 없어서, DB 제약에 막혀 저장이 안 되는',
    '--    종류의 결함(#22)이 CI 에서 잡히지 않는다. 이 파일이 그 구멍을 메운다.',
    '--',
    '--  적용:',
    '--    mysql -h <host> -u <user> -p <db> < prisma/sql/003-check-constraints.sql',
    '--',
    '--  이미 제약이 있는 DB(스키마 원본으로 만든 로컬/운영)에서는 "Duplicate check constraint"',
    '--  로 실패한다. 그건 이미 그 상태라는 뜻이므로 무시해도 된다.',
    '--',
    '--  NULL 은 따로 허용하지 않는다 — `NULL IN (...)` 은 UNKNOWN 이고 CHECK 는 거짓일 때만',
    '--  막으므로, nullable 컬럼은 자동으로 NULL 을 통과시킨다.',
    '-- =====================================================================================',
    '',
  ];

  for (const c of CONTRACTS) {
    lines.push(`-- ${c.table}.${c.column} — ${c.note}`);
    lines.push(`ALTER TABLE ${c.table}`);
    lines.push(`  ADD CONSTRAINT ${constraintName(c)} CHECK (${c.column} IN (${toSqlList(c.values)}));`);
    lines.push('');
  }

  return lines.join('\n');
}
