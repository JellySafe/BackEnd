-- ============================================================================
-- risk_overrides — 운영자 수동 등급 상향 (ADM)
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────────────────
-- 지금은 룰 엔진이 낸 값이 그대로 시민에게 나간다. 현장이 "지금 명백히 위험한데 시스템은
-- 낮음" 이라고 판단해도 **손댈 방법이 없다.** 관측이 끊겼거나(해변 12곳 중 5곳이 그렇다),
-- 룰이 아직 모르는 상황(적조·해파리 대량 표착 등)에서 그 간극이 생긴다.
--
-- ── 왜 '상향' 만인가 ─────────────────────────────────────────────────────────────
-- 낮추는 조작은 두지 않는다. 위험을 낮추는 판단이 틀리면 **사람이 물에 들어간다.**
-- 올리는 판단이 틀리면 헛걱정으로 끝난다. 두 실수의 비용이 다르므로 방향을 하나만 연다.
-- (그래서 min_risk_level 에 'safe' 를 넣을 수 없다 — 아무것도 올리지 못하는 값이라
--  "내렸다" 고 착각하게 만들 뿐이다)
--
-- ── 왜 만료가 필수인가 ───────────────────────────────────────────────────────────
-- 기한 없는 상향은 **아무도 기억하지 않는 영구 상태**가 된다. 한 달 뒤에도 '위험' 인 해변을
-- 보고 아무도 이유를 모르는 상황이 이 기능의 가장 흔한 실패다. 그래서 expires_at 은 NOT NULL
-- 이고, 도메인이 최대 기간도 제한한다(risk-override.ts).
--
-- 적용: mysql < prisma/sql/006-risk-overrides.sql
--       (DB-first — 운영에서는 prisma migrate 를 쓰지 않는다)
-- ============================================================================

CREATE TABLE IF NOT EXISTS risk_overrides (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  beach_id        BIGINT       NOT NULL,
  min_risk_level  VARCHAR(20)  NOT NULL COMMENT '보장할 최소 단계. 산출 결과가 이보다 낮으면 여기까지 끌어올린다',
  reason          VARCHAR(300) NOT NULL COMMENT '상향 사유. 필수 — 이유 없는 상향은 나중에 해제 판단을 할 수 없다',
  created_by      BIGINT       NULL COMMENT '지시한 운영자. 계정이 지워져도 기록은 남긴다(SET NULL)',
  starts_at       DATETIME     NOT NULL,
  expires_at      DATETIME     NOT NULL COMMENT '자동 해제 시각. NULL 을 허용하지 않는다 — 영구 상향을 막는다',
  released_at     DATETIME     NULL COMMENT '만료 전에 손으로 해제한 시각',
  released_by     BIGINT       NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_risk_overrides_beach    FOREIGN KEY (beach_id)    REFERENCES beaches (id) ON DELETE CASCADE,
  CONSTRAINT fk_risk_overrides_creator  FOREIGN KEY (created_by)  REFERENCES users (id)   ON DELETE SET NULL,
  CONSTRAINT fk_risk_overrides_releaser FOREIGN KEY (released_by) REFERENCES users (id)   ON DELETE SET NULL,
  -- 산출 때마다 "이 해변의 지금 유효한 상향" 을 찾는다. 그 조회가 이 인덱스를 탄다.
  KEY ix_risk_overrides_active (beach_id, expires_at, released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='운영자 수동 등급 상향. 엔진 산출값을 낮추지는 못하고 올리기만 한다';
