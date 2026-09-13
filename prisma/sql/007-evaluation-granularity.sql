-- =====================================================================================
-- 007. prediction_evaluations.actual_granularity — 이 판정의 정답이 어느 해상도에서 왔나
--
-- 국립수산과학원 주간보고는 출현을 **시군구 이름**으로만 적는다(PDF 에 좌표가 없다).
-- 좌표를 요구하면 실데이터로는 정답이 0건이고, 시군구로 붙이면 같은 시의 해변이 전부 같은
-- 판정을 받아 해변별 변별력이 사라진다.
--
-- 그래서 버리지 않고 **표시한다.** 전체 정확도는 둘 다 세고, 해변별 정확도는 beach 만 센다.
--
-- 기본값이 'beach' 인 이유 — 이 컬럼이 생기기 전의 행은 현장 관측·쏘임 사고·좌표 있는 출현
-- 에서만 나왔다. 전부 해변 단위다. 기본값을 'region' 으로 두면 과거 판정이 통째로 해변별
-- 지표에서 빠진다.
--
-- 적용:
--   mysql -u root -p jellysafe < prisma/sql/007-evaluation-granularity.sql
-- =====================================================================================

ALTER TABLE prediction_evaluations
  ADD COLUMN actual_granularity VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'beach'
  COMMENT '정답의 해상도. beach=그 해변의 증거, region=시군구 단위 증거를 붙인 것'
  AFTER incident_count;

-- CHECK 제약은 여기 쓰지 않는다. 값 계약(prisma/value-contracts.ts)에서 생성되는
-- 999-check-constraints.sql 한 곳에 모여 있어야 하고, 그 일치를 테스트가 강제한다
-- (여기에 손으로 적으면 두 곳이 갈라지고, 갈라진 쪽은 아무도 안 본다).
--   npm run sql:check-constraints

-- 해변별 지표는 beach 만 센다. 그 필터가 타는 인덱스.
ALTER TABLE prediction_evaluations
  ADD KEY ix_prediction_evaluations_granularity_date (actual_granularity, target_date);
