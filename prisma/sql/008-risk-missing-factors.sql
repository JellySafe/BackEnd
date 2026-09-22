-- =====================================================================================
-- 008. risk_scores.missing_factors — 이 산출에서 평가하지 못한 위험 요인
--
-- 엔진은 이미 결측 요인을 알고 있다(risk-assessment.ts 의 missing 배열). 그런데
-- deriveConfidence(missingCount, age) 가 **개수만 받고 코드는 버린다.**
--
-- 그래서 화면에는 신뢰도가 'medium' 이라고만 나오고, 왜 medium 인지는 아무 데도 없다.
-- 운영자는 "수집이 밀렸나" 하고 기다리게 되는데, 실제로는 그 해변에 붙은 파고부이가
-- 유향·유속을 아예 관측하지 않아서 CURRENT_INFLOW 가 영원히 결측인 경우가 있다.
-- 기다려도 오지 않는다.
--
-- 매핑 진단(GET /admin/observation-mappings)이 **지금** 상태를 답한다면, 이 컬럼은
-- **그때** 상태를 답한다 — "9월 22일 이 해변이 왜 medium 이었나" 는 산출 기록에만 남는다.
--
-- ⚠️ 값 계약(CHECK)을 걸지 않는다. 한 칸에 여러 코드가 쉼표로 들어가므로 IN 목록으로
--    검사할 수 없다. 대신 **엔진이 만든 코드만** 들어오고(사용자 입력이 아니다), 길이를
--    넉넉히 잡아 잘림을 막는다. 룰이 늘어 255자를 넘기면 그때 컬럼을 늘린다.
--
-- 적용:
--   mysql -u root -p jellysafe < prisma/sql/008-risk-missing-factors.sql
-- =====================================================================================

ALTER TABLE risk_scores
  ADD COLUMN missing_factors VARCHAR(255) NULL
  COMMENT '평가하지 못한 위험 요인 코드(쉼표 구분). NULL 이면 결측 없음 — 빈 문자열과 구분한다'
  AFTER data_confidence;
