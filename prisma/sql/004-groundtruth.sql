-- =====================================================================================
--  운영 DB 에 수동으로 적용하는 DDL — 정답 데이터 (groundtruth 컨텍스트)
--
--  이 프로젝트는 DB-first 다. 스키마 원본은 `../db/jellysafe_schema.sql`(ERwin/MySQL DDL)이고
--  `prisma migrate` 를 운영에 쓰지 않으므로, 새 테이블은 여기에 적어 두고 운영자가 직접 적용한다.
--
--  적용:
--    mysql -h <host> -u <user> -p <db> < prisma/sql/004-groundtruth.sql
--
--  ── 왜 필요한가 ────────────────────────────────────────────────────────────────────
--  지금까지 이 서비스는 **자기가 맞았는지 알 수 없는 구조**였다. 위험도는 `해변 × 시점` 단위로
--  내는데, 검증에 쓴 정답은 국립수산과학원 주간보고의 `시군구 × 주` 단위다.
--  docs/backtest.md 가 그 한계를 직접 적어 두었다:
--
--    "해변별 변별력은 현재 어떤 룰도 만들어내지 못하고 있으며, 이 백테스트로는 검증할 수도
--     없다(정답이 광역 단위라서). 해변 단위 예측을 주장하려면 해변 단위 정답 데이터가 필요하다."
--
--  이 세 테이블이 그 정답을 모으고, 과거 예측과 대조한 결과를 남긴다.
--
--  적용 전/후로 애플리케이션은 **둘 다 뜬다.** 적용 전에는 관측/사고 기록 API 가 503 이고
--  대조 배치가 건너뛴다(기존 기능에는 영향이 없다).
--
--  적용 후 `npx prisma db pull` 로 schema.prisma 와 대조하면 코드와 DB 가 맞는지 확인할 수 있다.
--  스키마 원본(db/jellysafe_schema.sql)에도 같은 정의를 반영해 두어야 새 환경 구축 때 빠지지 않는다.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. field_observations — 현장 관측 기록
--
--    ⚠️ **부재 관측(jellyfish_present = 0)이 이 테이블의 존재 이유다.**
--    시민 제보(jellyfish_reports)는 본 사람만 올리므로 "제보 없음" 이 "해파리 없음" 을 뜻하지
--    않는다. 그 데이터로는 **오경보를 셀 수 없다.** 여기에는 정해진 사람이 정해진 시각에
--    "있었다/없었다" 를 모두 남긴다.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_observations (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  beach_id          BIGINT       NOT NULL,

  -- 관측한 시각(신고 시각이 아니다). 대조는 이 값의 날짜(KST)로 묶는다.
  observed_at       DATETIME     NOT NULL,

  -- 값 목록은 CHECK 로 고정하고 콜레이션을 bin 으로 둔다(이 저장소의 상태값 규약).
  source            VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,

  observer_id       BIGINT       NULL,
  observer_name     VARCHAR(50)  NULL,

  -- 0 도 유효한 기록이다. 이 컬럼이 nullable 이 아닌 이유 — "모름" 을 허용하면
  -- 부재 관측과 미기재가 섞여 오경보율을 잴 수 없게 된다.
  jellyfish_present TINYINT(1)   NOT NULL,

  -- present=1 이면 필수, present=0 이면 NULL 이어야 한다(애플리케이션 불변식).
  density_level     VARCHAR(20) COLLATE utf8mb4_bin NULL,
  species_id        BIGINT       NULL,
  estimated_count   INT          NULL,
  note              VARCHAR(500) NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- 대조 배치가 (해변, 날짜) 로 훑는다. 이 인덱스가 그 스캔의 전부다.
  KEY ix_field_observations_beach_time (beach_id, observed_at),

  CONSTRAINT fk_field_observations_beach
    FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
  -- 관측자 계정이 지워져도 관측 기록은 남아야 한다(정답 데이터다).
  CONSTRAINT fk_field_observations_observer
    FOREIGN KEY (observer_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_field_observations_species
    FOREIGN KEY (species_id) REFERENCES jellyfish_species (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='현장 관측 기록(부재 포함) — 해변 단위 정답 데이터';

-- -------------------------------------------------------------------------------------
-- 2. sting_incidents — 쏘임 사고 기록
--
--    가장 강한 정답이다. 현장 관측은 "위험해 보였다" 이고 이건 **실제로 피해가 났다** 이다.
--
--    ⚠️ 환자의 이름·연락처·상병은 **컬럼이 없다.** 필요한 것은 "그날 그 해변에서 몇 명이
--    얼마나 다쳤는가" 뿐이고 그 이상은 보관할 근거가 없다. 스키마에 없으면 실수로도 안 들어온다.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sting_incidents (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  beach_id      BIGINT       NOT NULL,
  occurred_at   DATETIME     NOT NULL,
  source        VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  severity      VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,

  -- 1 이상. 0명짜리 행이 들어오면 그날이 "위험했다" 로 판정된다.
  patient_count INT          NOT NULL,
  species_id    BIGINT       NULL,

  -- 외부 기관 시스템의 사건 식별자. 같은 사고가 안전요원과 119 양쪽에서 들어올 때 묶는 열쇠다.
  -- UNIQUE 를 걸지 않는 이유: 값이 없는 기록(직접 입력)이 대부분이고, NULL 이 여럿이면
  -- UNIQUE 가 막지 않으므로 실효가 없다. 병합은 사람이 판단한다(자동 병합은 건수를 줄인다).
  external_ref  VARCHAR(100) NULL,

  note          VARCHAR(500) NULL,
  reported_by   BIGINT       NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY ix_sting_incidents_beach_time (beach_id, occurred_at),
  KEY ix_sting_incidents_external_ref (external_ref),

  CONSTRAINT fk_sting_incidents_beach
    FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
  CONSTRAINT fk_sting_incidents_species
    FOREIGN KEY (species_id) REFERENCES jellyfish_species (id) ON DELETE SET NULL,
  CONSTRAINT fk_sting_incidents_reporter
    FOREIGN KEY (reported_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='쏘임 사고 기록 — 가장 강한 정답 데이터(개인정보 미보관)';

-- -------------------------------------------------------------------------------------
-- 3. prediction_evaluations — 예측 대조 결과
--
--    대조 단위는 **해변 × 하루**다. 시점 단위로 맞추지 않는 이유는 정답이 그 해상도를 감당하지
--    못하기 때문이다(현장 관측은 하루 두세 번, 사고 시각은 신고 시각이라 부정확하다).
--
--    같은 (해변, 날짜)를 다시 평가하면 **덮어쓴다**(UNIQUE). 관측이나 사고가 늦게 들어오는
--    일이 흔하므로 재평가가 정상 동작이고, 그때마다 행이 쌓이면 집계가 중복된다.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prediction_evaluations (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  beach_id          BIGINT       NOT NULL,

  -- KST 기준 날짜. 이 서비스의 모든 '하루' 는 KST 다(shared/kernel/kst-date.ts).
  target_date       DATE         NOT NULL,

  -- 그날 그 해변 예측 중 **최고** 단계. 평균이 아니다 — 짧고 강한 경보가 지워지면 안 된다.
  predicted_level   VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  predicted_score   SMALLINT     NOT NULL,

  -- 실제로 관측된 것.
  observed          TINYINT(1)   NOT NULL,
  actual_density    VARCHAR(20) COLLATE utf8mb4_bin NULL,
  incident_count    INT          NOT NULL DEFAULT 0,

  -- hit / miss / false_alarm / correct_negative
  outcome           VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,

  -- 판정에 쓴 경보 임계선. 정책이 바뀌면 과거 지표와 비교할 수 없으므로 행에 박아 둔다.
  alert_threshold   VARCHAR(20) COLLATE utf8mb4_bin NOT NULL,
  -- 판정 시점의 위험도 룰 버전. 어느 점수표가 낸 예측인지 알아야 개선을 논할 수 있다.
  rule_version      VARCHAR(20)  NOT NULL,

  evaluated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_prediction_evaluations_beach_date (beach_id, target_date),
  KEY ix_prediction_evaluations_date_outcome (target_date, outcome),

  CONSTRAINT fk_prediction_evaluations_beach
    FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='예측 대조 결과(해변 × 하루) — 정확도 지표의 원천';
