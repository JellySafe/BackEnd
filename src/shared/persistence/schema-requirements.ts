/**
 * 코드가 **반드시 있다고 가정하는** 스키마 요소.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 이 저장소는 DB-first 라 운영에 `prisma migrate` 를 쓰지 않는다. `prisma/sql/*.sql` 을
 * **사람이 확인하고 적용한다.** 그래서 코드만 배포되고 DDL 이 빠지는 일이 구조적으로 가능하다.
 *
 * ⚠️ 그때 앱은 **멀쩡히 뜬다.** 그리고 조용히 못 한다 — 예를 들어 `missing_factors` 가 없으면
 *    위험도 저장이 매번 실패해서 **시민 화면에 아무 단계도 안 나온다.** 기동 로그는 정상이고,
 *    실패는 한 시간 뒤 배치에서 처음 드러난다.
 *
 * "조용히 열린 채 뜨는 것보다 실패하는 쪽이 낫다" 는 이 저장소의 기준을 스키마에도 적용한다
 * (CORS_ORIGIN 이 운영에서 기동을 막는 것과 같은 이유다).
 *
 * ── 이 목록을 언제 고치나 ────────────────────────────────────────────────────────────
 * `prisma/sql/` 에 파일을 추가하면서 **함께** 적는다. 안 적으면 다음 사람이 DDL 을 빠뜨려도
 * 아무도 모른다 — 이 목록의 값은 빠짐없음에 있다.
 *
 * ⚠️ 여기에 적는 것은 **코드가 없으면 못 도는 것**만이다. 인덱스처럼 있으면 빠르고 없으면
 *    느린 것은 적지 않는다. 기동을 막을 근거가 아니다.
 */

export interface SchemaRequirement {
  table: string;
  /** 없으면 테이블 자체만 확인한다. */
  column?: string;
  /** 이 요소를 만드는 SQL 파일. 오류 메시지에 그대로 실어 운영자가 바로 적용할 수 있게 한다. */
  sqlFile: string;
  /** 없으면 무엇이 안 되는가. 기동을 막는 이유를 사람 말로 남긴다. */
  breaks: string;
}

export const SCHEMA_REQUIREMENTS: readonly SchemaRequirement[] = [
  {
    table: 'refresh_tokens',
    sqlFile: '002-refresh-tokens.sql',
    breaks: '관리자 로그인 세션 재발급이 전부 실패한다',
  },
  {
    table: 'field_observations',
    sqlFile: '004-groundtruth.sql',
    breaks: '현장 관측 기록과 예측 대조가 전부 실패한다',
  },
  {
    table: 'prediction_evaluations',
    column: 'actual_granularity',
    sqlFile: '007-evaluation-granularity.sql',
    breaks: '예측 대조 배치가 매번 실패해 정확도가 영원히 비어 있다',
  },
  {
    table: 'risk_scores',
    column: 'missing_factors',
    sqlFile: '008-risk-missing-factors.sql',
    breaks: '위험도 저장이 매번 실패해 시민 화면에 아무 단계도 나오지 않는다',
  },
  {
    table: 'static_guide_translations',
    sqlFile: '009-static-guide-translations.sql',
    breaks: '안내 문구 조회가 실패해 응급대처법이 화면에서 사라진다',
  },
  {
    table: 'risk_overrides',
    sqlFile: '006-risk-overrides.sql',
    breaks: '운영자가 위험 단계를 손으로 올릴 수 없다',
  },
  {
    table: 'daily_reports',
    column: 'public_comment',
    sqlFile: '005-daily-report-public-comment.sql',
    breaks: '일간 리포트의 공개 코멘트를 저장할 수 없다',
  },
];
