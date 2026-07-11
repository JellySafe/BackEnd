-- =====================================================================================
--  JellySafe - 물리 데이터 모델 (DDL)
-- =====================================================================================
--  Source     : 젤리 세이프_IA_기능정의서_v2.xlsm
--                 - 01_IA_기능정의  (G-*, ADM-*, USR-*, SYS-*, EX-*)
--                 - 02_정책서        (AUTH-*, RISK-*, AI-*, REPORT-*, OP-*, NOTI-*, PRIV-*)
--                 - 03_Data_AI       (위험 변수 / 제보 가중치 / 위험 단계 / 최소 단계 보장)
--                 - 04_API_DB        (테이블·컬럼 원본 정의)
--                 - 05_Flow_검수     (FLOW-*, CHECK-DEV)
--
--  Target DBMS : MySQL 8.0.16 이상  (CHECK 제약이 실제로 강제되는 최소 버전)
--  Charset     : utf8mb4 / utf8mb4_0900_ai_ci
--  Engine      : InnoDB
--  Timezone    : 모든 DATETIME 컬럼은 UTC 기준으로 저장한다. 표시 변환은 애플리케이션 책임.
--
--  ERwin 임포트 안내
--    - Target Database 를 MySQL 8.x 로 지정한 뒤 Reverse Engineer > Script File 로 읽는다.
--    - 테이블/컬럼 COMMENT 는 ERwin 의 Definition 속성으로 매핑된다.
--    - 상태값은 네이티브 ENUM 대신 VARCHAR + CHECK 로 정의했다.
--      (ERwin 이 MySQL ENUM 을 도메인으로 안정적으로 역공학하지 못하고,
--       값 추가 시 CHECK 재정의가 ENUM 변경보다 리뷰하기 쉽기 때문)
--
--  ★ 상태값 컬럼의 COLLATE utf8mb4_bin
--    CHECK ... IN (...) 으로 값 목록이 고정된 46개 컬럼에는 utf8mb4_bin 을 지정했다.
--    DB 기본 콜레이션 utf8mb4_0900_ai_ci 는 대소문자를 구분하지 않으므로
--    risk_level='DANGER' 같은 값이 CHECK 를 그대로 통과해 저장된다.
--    Spring Data JPA 의 @Enumerated(EnumType.STRING) 은 자바 enum 이름을 그대로 기록하니
--    관례상 대문자(DANGER)가 들어가기 쉽지만, 이 문서의 계약값은 소문자(danger)다.
--    bin 콜레이션을 걸면 대문자 삽입이 INSERT 시점에 CHECK 위반으로 즉시 실패한다.
--    조회 시 WHERE risk_level='danger' 와 _ci 컬럼과의 조인은 정상 동작함을 실제로 검증했다.
--    자바 enum 을 쓸 경우 소문자 상수 또는 @Converter 로 매핑할 것.
--    (네이티브 ENUM 은 'DANGER' 를 조용히 'danger' 로 정규화해 오히려 오류를 숨긴다)
--
--  섹션 구성
--    1. 마스터 / 공통          : users, beaches, static_guides, risk_recommendations
--    2. 데이터 수집 (SYS-001/002): data_sources, observation_stations, observations,
--                                observation_mappings, jellyfish_occurrences
--    3. 제보 (USR-004/005, ADM-008/009)
--                              : consent_logs, jellyfish_reports, report_consents,
--                                vision_results, report_reviews
--    4. 위험도 산출 (SYS-003)   : risk_rule_configs, risk_calculations, risk_scores, risk_factors
--    5. 운영 대응 (ADM-006/007) : operation_actions, operation_status_logs
--    6. 알림 (SYS-005, ADM-010) : notification_templates, notifications
--    7. 리포트 (ADM-011)        : daily_reports
--    8. 사용자 부가 / 감사       : favorite_beaches, audit_logs
--    9. 2차 확장 (EX-001~004)   : notification_consents, notification_dispatches,
--                                partners, partner_api_keys, partner_api_call_logs,
--                                ml_models, subscriptions, subscription_areas
--
--  ※ 기능정의서 원본 대비 변경/보완한 부분은 파일 최하단 [설계 노트]에 모두 기록했다.
-- =====================================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS subscription_areas;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS ml_models;
DROP TABLE IF EXISTS partner_api_call_logs;
DROP TABLE IF EXISTS partner_api_keys;
DROP TABLE IF EXISTS partners;
DROP TABLE IF EXISTS notification_dispatches;
DROP TABLE IF EXISTS notification_consents;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS favorite_beaches;
DROP TABLE IF EXISTS daily_reports;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS operation_status_logs;
DROP TABLE IF EXISTS operation_actions;
DROP TABLE IF EXISTS risk_factors;
DROP TABLE IF EXISTS risk_scores;
DROP TABLE IF EXISTS risk_calculations;
DROP TABLE IF EXISTS risk_rule_configs;
DROP TABLE IF EXISTS report_reviews;
DROP TABLE IF EXISTS vision_results;
DROP TABLE IF EXISTS report_consents;
DROP TABLE IF EXISTS jellyfish_reports;
DROP TABLE IF EXISTS consent_logs;
DROP TABLE IF EXISTS jellyfish_occurrences;
DROP TABLE IF EXISTS observation_mappings;
DROP TABLE IF EXISTS observations;
DROP TABLE IF EXISTS observation_stations;
DROP TABLE IF EXISTS data_sources;
DROP TABLE IF EXISTS risk_recommendations;
DROP TABLE IF EXISTS static_guides;
DROP TABLE IF EXISTS beaches;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;


-- =====================================================================================
-- 1. 마스터 / 공통
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- users : 사용자/관리자 계정
--   - TERM-002 관리자(지자체·운영기관·안전관리 담당자), TERM-003 일반 사용자
--   - AUTH-001 역할별 기능 접근. MVP 일반 사용자는 익명(비로그인)이므로 행이 생성되지 않는다.
-- -------------------------------------------------------------------------------------
CREATE TABLE users (
    id             BIGINT                          NOT NULL AUTO_INCREMENT              COMMENT '사용자 PK',
    role           VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'public'            COMMENT '역할: public(일반)/operator(운영자)/admin(관리자)',
    email          VARCHAR(255)                    NOT NULL                             COMMENT '로그인 이메일',
    password_hash  VARCHAR(255)                    NOT NULL                             COMMENT '단방향 해시(BCrypt 등). 평문 저장 금지',
    name           VARCHAR(100)                    NOT NULL                             COMMENT '사용자 이름',
    organization   VARCHAR(150)                    NULL                                 COMMENT '소속 기관(지자체/해수욕장 운영기관 등)',
    managed_region VARCHAR(50)                     NULL                                 COMMENT '운영자 담당 지역. AUTH-001 상 operator 는 담당 해변만 검수/기록',
    is_active      BOOLEAN                         NOT NULL DEFAULT 1                   COMMENT '계정 활성 여부',
    last_login_at  DATETIME                        NULL                                 COMMENT '최근 로그인 시각(UTC)',
    created_at     DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP   COMMENT '생성 시각(UTC)',
    updated_at     DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uk_users_email UNIQUE (email),
    CONSTRAINT ck_users_role CHECK (role IN ('public','operator','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자/관리자 계정. G-002 권한 매트릭스의 주체';


-- -------------------------------------------------------------------------------------
-- beaches : 해수욕장 마스터
--   - 03_Data_AI: MVP 1순위 해변 = 협재, 함덕, 이호테우, 중문, 표선
--   - BEACH_VULNERABILITY(+5) 산출에 vulnerability_score 사용
-- -------------------------------------------------------------------------------------
CREATE TABLE beaches (
    id                  BIGINT        NOT NULL AUTO_INCREMENT           COMMENT '해수욕장 PK',
    name                VARCHAR(100)  NOT NULL                          COMMENT '해변명 (예: 협재해수욕장)',
    region              VARCHAR(50)   NOT NULL                          COMMENT '행정 지역 (예: 제주시, 서귀포시)',
    lat                 DECIMAL(10,7) NOT NULL                          COMMENT '위도. 좌표 누락 시 지도 마커 제외',
    lng                 DECIMAL(10,7) NOT NULL                          COMMENT '경도',
    facing_direction    SMALLINT      NULL                              COMMENT '해변이 바라보는 방위각(0~359). WIND_INFLOW 유입 판정에 사용',
    priority            SMALLINT      NOT NULL DEFAULT 99               COMMENT 'MVP 노출 우선순위. 1순위 5개 해변이 1~5',
    vulnerability_score SMALLINT      NOT NULL DEFAULT 0                COMMENT '해변 취약도 가중치(BEACH_VULNERABILITY). 초기값은 PM 확정',
    is_active           BOOLEAN       NOT NULL DEFAULT 1                COMMENT '서비스 노출 여부',
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_beaches PRIMARY KEY (id),
    CONSTRAINT uk_beaches_name UNIQUE (name),
    CONSTRAINT ck_beaches_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_beaches_lng CHECK (lng BETWEEN -180 AND 180),
    CONSTRAINT ck_beaches_facing CHECK (facing_direction IS NULL OR facing_direction BETWEEN 0 AND 359),
    CONSTRAINT ck_beaches_vuln CHECK (vulnerability_score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해수욕장 마스터. 지도/검색/위험도 산출의 기준 엔터티';


-- -------------------------------------------------------------------------------------
-- static_guides : 정적 안내/고지 문구
--   - G-006 위험도 참고 정보 고지, DISCLAIMER-001 최종 판단 주체
--   - GUIDE-001(관광객: 행동 중심) / GUIDE-002(관리자: 의사결정 중심)
-- -------------------------------------------------------------------------------------
CREATE TABLE static_guides (
    id            BIGINT                          NOT NULL AUTO_INCREMENT             COMMENT '안내 문구 PK',
    guide_code    VARCHAR(50)                     NOT NULL                            COMMENT '문구 코드 (예: DISCLAIMER_PUBLIC)',
    target_type   VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                            COMMENT '노출 대상: public/operator/admin/common',
    risk_level    VARCHAR(20) COLLATE utf8mb4_bin NULL                                COMMENT '특정 위험 단계 전용 문구인 경우 지정. 전역 문구는 NULL',
    title         VARCHAR(200)                    NULL                                COMMENT '문구 제목',
    body          TEXT                            NOT NULL                            COMMENT '문구 본문',
    display_order SMALLINT                        NOT NULL DEFAULT 0                  COMMENT '노출 순서',
    active        BOOLEAN                         NOT NULL DEFAULT 1                  COMMENT '사용 여부. G-006 상 고지 문구는 미노출 금지',
    created_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP  COMMENT '생성 시각(UTC)',
    updated_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_static_guides PRIMARY KEY (id),
    CONSTRAINT uk_static_guides_code UNIQUE (guide_code),
    CONSTRAINT ck_static_guides_target CHECK (target_type IN ('public','operator','admin','common')),
    CONSTRAINT ck_static_guides_level CHECK (risk_level IS NULL OR risk_level IN ('safe','caution','danger','severe'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='책임 고지/안전 가이드 등 정적 문구. G-006, DISCLAIMER-001';


-- -------------------------------------------------------------------------------------
-- risk_recommendations : 위험 단계별 대응 권고 마스터
--   - ADM-006 대응 권고 확인, GET /admin/recommendations
--   - RISK-003: 권고는 참고 정보이며 자동 실행되지 않는다. 실제 조치는 operation_actions 에 수동 기록.
-- -------------------------------------------------------------------------------------
CREATE TABLE risk_recommendations (
    id            BIGINT                          NOT NULL AUTO_INCREMENT             COMMENT '권고 PK',
    action_code   VARCHAR(50)                     NOT NULL                            COMMENT '권고 코드 (예: MONITORING_UP, ENTRY_CAUTION)',
    risk_level    VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                            COMMENT '적용 위험 단계: caution/danger/severe',
    title         VARCHAR(200)                    NOT NULL                            COMMENT '권고 제목 (예: 입수 주의 안내)',
    description   TEXT                            NULL                                COMMENT '권고 사유/부연 설명',
    display_order SMALLINT                        NOT NULL DEFAULT 0                  COMMENT '노출 순서',
    active        BOOLEAN                         NOT NULL DEFAULT 1                  COMMENT '사용 여부',
    created_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP  COMMENT '생성 시각(UTC)',
    updated_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_risk_recommendations PRIMARY KEY (id),
    CONSTRAINT uk_risk_recommendations_code UNIQUE (action_code),
    CONSTRAINT ck_risk_recommendations_level CHECK (risk_level IN ('caution','danger','severe'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='위험 단계별 운영 대응 권고 마스터. ADM-006';


-- =====================================================================================
-- 2. 데이터 수집 (SYS-001 해양·기상 데이터 수집 / SYS-002 관측소-해수욕장 매핑)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- data_sources : 외부 데이터 소스 카탈로그
--   - G-004 데이터 최신 수집 시각(last_synced_at) 노출의 근거
--   - SYS-001: API 제한/결측/지연 상태를 추적한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE data_sources (
    id                    BIGINT                          NOT NULL AUTO_INCREMENT           COMMENT '데이터 소스 PK',
    source_code           VARCHAR(50)                     NOT NULL                          COMMENT '소스 코드 (예: NIFS_JELLYFISH, KHOA_MARINE, KMA_WEATHER)',
    name                  VARCHAR(150)                    NOT NULL                          COMMENT '소스명',
    provider              VARCHAR(100)                    NULL                              COMMENT '제공 기관 (국립수산과학원, 해양수산부 등)',
    source_type           VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                          COMMENT '유형: jellyfish(출현·속보)/marine(해양)/weather(기상)/beach(해변정보)',
    endpoint_url          VARCHAR(500)                    NULL                              COMMENT '수집 엔드포인트. 샘플 데이터 대체 시 NULL',
    is_sample             BOOLEAN                         NOT NULL DEFAULT 0                COMMENT '1이면 MVP 샘플 데이터. SYS-001 상 샘플 대체 허용',
    sync_interval_minutes INT                             NULL                              COMMENT '수집 주기(분)',
    last_synced_at        DATETIME                        NULL                              COMMENT '최근 수집 성공 시각(UTC). G-004 최신성 배지에 사용',
    last_sync_status      VARCHAR(20) COLLATE utf8mb4_bin NULL                              COMMENT '최근 수집 결과: success/partial/failed',
    last_sync_message     VARCHAR(500)                    NULL                              COMMENT '실패 사유/경고 메시지',
    is_active             BOOLEAN                         NOT NULL DEFAULT 1                COMMENT '수집 활성 여부',
    created_at            DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    updated_at            DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_data_sources PRIMARY KEY (id),
    CONSTRAINT uk_data_sources_code UNIQUE (source_code),
    CONSTRAINT ck_data_sources_type CHECK (source_type IN ('jellyfish','marine','weather','beach')),
    CONSTRAINT ck_data_sources_sync_status CHECK (last_sync_status IS NULL OR last_sync_status IN ('success','partial','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='공공데이터 소스 카탈로그 및 수집 상태. SYS-001';


-- -------------------------------------------------------------------------------------
-- observation_stations : 관측소 마스터
--   - SYS-002: 해수욕장과 가까운 관측소를 위/경도 기준 최근접 매핑한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE observation_stations (
    id           BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '관측소 PK',
    source_id    BIGINT                          NOT NULL                           COMMENT '데이터 소스 FK',
    station_code VARCHAR(50)                     NOT NULL                           COMMENT '관측소 코드(제공 기관 기준)',
    name         VARCHAR(150)                    NOT NULL                           COMMENT '관측소명',
    station_type VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '관측 유형: marine(해양)/weather(기상)',
    lat          DECIMAL(10,7)                   NOT NULL                           COMMENT '위도',
    lng          DECIMAL(10,7)                   NOT NULL                           COMMENT '경도',
    is_active    BOOLEAN                         NOT NULL DEFAULT 1                 COMMENT '사용 여부',
    created_at   DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_observation_stations PRIMARY KEY (id),
    CONSTRAINT uk_observation_stations_code UNIQUE (source_id, station_code),
    CONSTRAINT fk_observation_stations_source FOREIGN KEY (source_id) REFERENCES data_sources (id) ON DELETE RESTRICT,
    CONSTRAINT ck_observation_stations_type CHECK (station_type IN ('marine','weather')),
    CONSTRAINT ck_observation_stations_lat CHECK (lat BETWEEN -90 AND 90),
    CONSTRAINT ck_observation_stations_lng CHECK (lng BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해양/기상 관측소 마스터. SYS-002';


-- -------------------------------------------------------------------------------------
-- observations : 관측 시계열
--   - 03_Data_AI 해양 데이터(수온/염분/파고/유향/유속) + 기상 데이터(풍향/풍속/기온/강수)
--   - 결측 컬럼은 NULL 로 저장하고, 위험도 산출 시 0점 처리 + 신뢰도 하향 (RISK-005)
-- -------------------------------------------------------------------------------------
CREATE TABLE observations (
    id                BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '관측 레코드 PK',
    station_id        BIGINT                          NOT NULL                           COMMENT '관측소 FK',
    observed_at       DATETIME                        NOT NULL                           COMMENT '관측 시각(UTC). 시간 단위로 정렬됨',
    water_temp        DECIMAL(4,1)                    NULL                               COMMENT '수온(℃). TEMP_UP / TEMP_7D_AVG 산출 입력',
    salinity          DECIMAL(5,2)                    NULL                               COMMENT '염분(psu)',
    wave_height       DECIMAL(4,2)                    NULL                               COMMENT '유의파고(m). WAVE_HIGH 산출 입력',
    current_direction SMALLINT                        NULL                               COMMENT '유향(0~359도). CURRENT_INFLOW 산출 입력',
    current_speed     DECIMAL(5,2)                    NULL                               COMMENT '유속(cm/s)',
    wind_direction    SMALLINT                        NULL                               COMMENT '풍향(0~359도). WIND_INFLOW 산출 입력',
    wind_speed        DECIMAL(5,2)                    NULL                               COMMENT '풍속(m/s)',
    air_temp          DECIMAL(4,1)                    NULL                               COMMENT '기온(℃)',
    precipitation     DECIMAL(6,2)                    NULL                               COMMENT '강수량(mm)',
    quality_flag      VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'normal'          COMMENT '품질 플래그: normal/missing(결측)/outlier(이상치 제거 대상)',
    collected_at      DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '수집 시각(UTC)',
    CONSTRAINT pk_observations PRIMARY KEY (id),
    CONSTRAINT uk_observations_station_time UNIQUE (station_id, observed_at),
    CONSTRAINT fk_observations_station FOREIGN KEY (station_id) REFERENCES observation_stations (id) ON DELETE CASCADE,
    CONSTRAINT ck_observations_quality CHECK (quality_flag IN ('normal','missing','outlier')),
    CONSTRAINT ck_observations_wind_dir CHECK (wind_direction IS NULL OR wind_direction BETWEEN 0 AND 359),
    CONSTRAINT ck_observations_curr_dir CHECK (current_direction IS NULL OR current_direction BETWEEN 0 AND 359)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해양/기상 관측 시계열. SYS-001, SYS-002';


-- -------------------------------------------------------------------------------------
-- observation_mappings : 해수욕장 ↔ 관측소 매핑
--   - SYS-002: 위/경도 기준 최근접 관측소 매핑. 매핑 실패 시 data_confidence 하향.
--   - 해양/기상 각각 대표 관측소 1개(is_primary=1)를 지정한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE observation_mappings (
    id           BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '매핑 PK',
    beach_id     BIGINT                          NOT NULL                           COMMENT '해수욕장 FK',
    station_id   BIGINT                          NOT NULL                           COMMENT '관측소 FK',
    station_type VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '관측 유형: marine/weather',
    distance_km  DECIMAL(7,3)                    NULL                               COMMENT '해변-관측소 직선 거리(km)',
    is_primary   BOOLEAN                         NULL                               COMMENT '대표 관측소면 1, 아니면 NULL. uk 제약으로 유형별 대표 1건 보장',
    created_at   DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_observation_mappings PRIMARY KEY (id),
    CONSTRAINT uk_observation_mappings_pair UNIQUE (beach_id, station_id),
    CONSTRAINT uk_observation_mappings_primary UNIQUE (beach_id, station_type, is_primary),
    CONSTRAINT fk_observation_mappings_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_observation_mappings_station FOREIGN KEY (station_id) REFERENCES observation_stations (id) ON DELETE CASCADE,
    CONSTRAINT ck_observation_mappings_type CHECK (station_type IN ('marine','weather')),
    CONSTRAINT ck_observation_mappings_primary CHECK (is_primary IS NULL OR is_primary = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해수욕장-관측소 최근접 매핑. SYS-002';


-- -------------------------------------------------------------------------------------
-- jellyfish_occurrences : 해파리 출현/속보 (공공데이터)
--   - 03_Data_AI 데이터 소스 "해파리 출현/속보"
--   - PAST_OCCURRENCE(+15), NEARBY_ALERT(+15) 산출 입력. 사용자 제보와는 별개 데이터.
-- -------------------------------------------------------------------------------------
CREATE TABLE jellyfish_occurrences (
    id            BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '출현/속보 PK',
    source_id     BIGINT                          NOT NULL                           COMMENT '데이터 소스 FK',
    external_id   VARCHAR(100)                    NULL                               COMMENT '원본 시스템의 식별자(중복 수집 방지)',
    occurred_at   DATETIME                        NOT NULL                           COMMENT '출현 시점(UTC)',
    region        VARCHAR(50)                     NULL                               COMMENT '출현 해역/행정 구역',
    lat           DECIMAL(10,7)                   NULL                               COMMENT '출현 위도',
    lng           DECIMAL(10,7)                   NULL                               COMMENT '출현 경도',
    species       VARCHAR(100)                    NULL                               COMMENT '종별 정보 (예: 노무라입깃해파리)',
    is_toxic      BOOLEAN                         NULL                               COMMENT '독성 종 여부. 미상이면 NULL',
    density_level VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '출현량: low/medium/high',
    alert_level   VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '속보 단계: none/attention/caution/warning (기관 발표 기준)',
    description   VARCHAR(500)                    NULL                               COMMENT '원문 요약',
    collected_at  DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '수집 시각(UTC)',
    CONSTRAINT pk_jellyfish_occurrences PRIMARY KEY (id),
    CONSTRAINT uk_jellyfish_occurrences_ext UNIQUE (source_id, external_id),
    CONSTRAINT fk_jellyfish_occurrences_source FOREIGN KEY (source_id) REFERENCES data_sources (id) ON DELETE RESTRICT,
    CONSTRAINT ck_jellyfish_occurrences_density CHECK (density_level IS NULL OR density_level IN ('low','medium','high')),
    CONSTRAINT ck_jellyfish_occurrences_alert CHECK (alert_level IS NULL OR alert_level IN ('none','attention','caution','warning'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='공공데이터 기반 해파리 출현/속보 이력. PAST_OCCURRENCE, NEARBY_ALERT 입력';


-- =====================================================================================
-- 3. 제보 (USR-004 작성 / USR-005 결과 / ADM-008 목록 / ADM-009 검수)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- consent_logs : 개인정보/위치정보 동의 로그
--   - PRIV-001: 사진과 위치정보 수집 전 동의를 받는다.
--   - REPORT-001: 동의가 없으면 제보를 제출할 수 없다.
-- -------------------------------------------------------------------------------------
CREATE TABLE consent_logs (
    id             BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '동의 로그 PK',
    user_id        BIGINT                          NULL                               COMMENT '로그인 사용자 FK. 익명 제보 시 NULL. 계정 삭제 시 RESTRICT (동의 로그는 법적 증빙이므로 보존)',
    user_token     VARCHAR(64)                     NULL                               COMMENT '비로그인 사용자 식별 토큰(세션/디바이스 기반)',
    consent_type   VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '동의 유형: privacy(개인정보)/location(위치정보)/image(사진)/marketing(2차)',
    agreed         BOOLEAN                         NOT NULL                           COMMENT '동의 여부. 0이면 제보 제출 불가',
    policy_version VARCHAR(20)                     NOT NULL                           COMMENT '동의한 약관 버전',
    agreed_at      DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '동의 시각(UTC)',
    ip_address     VARCHAR(45)                     NULL                               COMMENT '동의 시점 IP (IPv6 대응 45자)',
    expires_at     DATETIME                        NULL                               COMMENT '보관 만료 시각. PRIV-003 보관 기간 정책 확정 후 적용',
    CONSTRAINT pk_consent_logs PRIMARY KEY (id),
    -- ON DELETE SET NULL 은 쓸 수 없다. MySQL 8 은 SET NULL 참조 액션이 걸린 컬럼을
    -- CHECK 제약에 사용하는 것을 금지한다(ERROR 3823). 동의 로그는 보존이 원칙이므로 RESTRICT.
    CONSTRAINT fk_consent_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_consent_logs_type CHECK (consent_type IN ('privacy','location','image','marketing')),
    CONSTRAINT ck_consent_logs_subject CHECK (user_id IS NOT NULL OR user_token IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='개인정보/위치정보 동의 로그. PRIV-001, PRIV-003';


-- -------------------------------------------------------------------------------------
-- jellyfish_reports : 사용자 제보
--   - REPORT-002 상태 전이: received → ai_processing → ai_done → verified/rejected/hold → reflected
--   - AI-001: ai_result 는 normal/toxic_suspected/unknown 만 사용. '독성 확정' 표현 금지.
--   - AI-002: 관리자 확인(verified) 이전에는 위험도 확정 데이터가 아니다.
-- -------------------------------------------------------------------------------------
CREATE TABLE jellyfish_reports (
    id                     BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '제보 PK',
    beach_id               BIGINT                          NULL                               COMMENT '해수욕장 FK. GPS 좌표만 입력된 경우 매핑 전까지 NULL',
    reporter_user_id       BIGINT                          NULL                               COMMENT '로그인 제보자 FK. 익명 제보 시 NULL. 계정 삭제 전 앱에서 익명화 처리 필요',
    reporter_token         VARCHAR(64)                     NULL                               COMMENT '비로그인 제보자 식별 토큰. REPORT-004 반복 제보 판정에 사용',
    lat                    DECIMAL(10,7)                   NULL                               COMMENT '제보 위도(GPS). GPS 거부 시 해변 선택으로 대체',
    lng                    DECIMAL(10,7)                   NULL                               COMMENT '제보 경도(GPS)',
    image_url              VARCHAR(500)                    NOT NULL                           COMMENT '원본 사진 URL. REPORT-001 상 사진 1장 이상 필수',
    thumbnail_url          VARCHAR(500)                    NULL                               COMMENT '목록용 썸네일 URL. ADM-008',
    report_type            VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '제보 상태: general(발견)/multiple(다수 출현)/sting(쏘임 사고)',
    status                 VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'received'        COMMENT '제보 처리 상태. REPORT-002 전이 순서 준수',
    ai_result              VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '최신 AI 판별 결과: normal/toxic_suspected/unknown. 원본 이력은 vision_results',
    ai_confidence          DECIMAL(5,4)                    NULL                               COMMENT '최신 AI 신뢰도 0.0000~1.0000. MIN_TOXIC_HIGH 기준 0.8',
    duplicate_of_report_id BIGINT                          NULL                               COMMENT '중복 후보로 판정된 원본 제보 FK. REPORT-004',
    occurred_at            DATETIME                        NOT NULL                           COMMENT '해파리 발견 시각(UTC). REPORT-001 필수 입력',
    submitted_at           DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '제보 접수 시각(UTC)',
    reflected_at           DATETIME                        NULL                               COMMENT '위험도 산출에 반영된 시각. status=reflected 시 기록',
    purge_scheduled_at     DATETIME                        NULL                               COMMENT '사진/위치정보 파기 예정 시각. PRIV-003 보관 기간 확정 후 적용',
    CONSTRAINT pk_jellyfish_reports PRIMARY KEY (id),
    KEY ix_jellyfish_reports_beach_time (beach_id, submitted_at DESC),
    CONSTRAINT fk_jellyfish_reports_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    -- ON DELETE SET NULL 금지(ERROR 3823). 또한 SET NULL 이 걸리면 로그인 제보자의
    -- reporter_user_id 가 NULL 이 되면서 ck_jellyfish_reports_reporter 를 위반하게 된다.
    -- 계정 삭제 시에는 앱에서 reporter_token 을 채워 익명화한 뒤 삭제할 것.
    CONSTRAINT fk_jellyfish_reports_user FOREIGN KEY (reporter_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_jellyfish_reports_duplicate FOREIGN KEY (duplicate_of_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL,
    CONSTRAINT ck_jellyfish_reports_type CHECK (report_type IN ('general','multiple','sting')),
    CONSTRAINT ck_jellyfish_reports_status CHECK (status IN ('received','ai_processing','ai_done','verified','rejected','hold','reflected')),
    CONSTRAINT ck_jellyfish_reports_ai_result CHECK (ai_result IS NULL OR ai_result IN ('normal','toxic_suspected','unknown')),
    CONSTRAINT ck_jellyfish_reports_ai_conf CHECK (ai_confidence IS NULL OR ai_confidence BETWEEN 0 AND 1),
    CONSTRAINT ck_jellyfish_reports_location CHECK (beach_id IS NOT NULL OR (lat IS NOT NULL AND lng IS NOT NULL)),
    CONSTRAINT ck_jellyfish_reports_reporter CHECK (reporter_user_id IS NOT NULL OR reporter_token IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자 해파리 제보. USR-004, USR-005, ADM-008, ADM-009';


-- -------------------------------------------------------------------------------------
-- report_consents : 제보 ↔ 동의 로그 연결
--   - POST /public/reports 의 consentIds 가 복수이므로 1:N 으로 정규화했다.
--     (04_API_DB 원본의 jellyfish_reports.consent_id 단일 컬럼을 대체)
-- -------------------------------------------------------------------------------------
CREATE TABLE report_consents (
    id             BIGINT   NOT NULL AUTO_INCREMENT            COMMENT '연결 PK',
    report_id      BIGINT   NOT NULL                           COMMENT '제보 FK',
    consent_log_id BIGINT   NOT NULL                           COMMENT '동의 로그 FK',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_report_consents PRIMARY KEY (id),
    CONSTRAINT uk_report_consents_pair UNIQUE (report_id, consent_log_id),
    CONSTRAINT fk_report_consents_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE,
    CONSTRAINT fk_report_consents_consent FOREIGN KEY (consent_log_id) REFERENCES consent_logs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='제보별 동의 내역 연결. REPORT-001, PRIV-001';


-- -------------------------------------------------------------------------------------
-- vision_results : 제보 이미지 AI 판별 이력
--   - SYS-004: MVP 는 Mock 또는 간단 분류 모델. 결과는 일반/독성 의심/판별 불가 + 신뢰도만 제공.
--   - AI-003: 사진 품질이 낮으면 unknown 으로 두고 관리자 수동 확인 대상으로 넘긴다.
--   - 재시도/모델 교체를 고려해 이력 테이블로 두고, 최신값만 jellyfish_reports 에 비정규화한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE vision_results (
    id             BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT 'AI 판별 결과 PK',
    report_id      BIGINT                          NOT NULL                           COMMENT '제보 FK',
    model_name     VARCHAR(100)                    NOT NULL DEFAULT 'VISION_MOCK'     COMMENT '판별 모델명. MVP 는 VISION_MOCK',
    model_version  VARCHAR(30)                     NULL                               COMMENT '모델 버전',
    result         VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '판별 결과: normal/toxic_suspected/unknown. 처리 실패 시 NULL',
    confidence     DECIMAL(5,4)                    NULL                               COMMENT '신뢰도 0.0000~1.0000',
    process_status VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending'         COMMENT '처리 상태: pending/processing/done/failed',
    error_message  VARCHAR(500)                    NULL                               COMMENT '처리 실패 사유',
    raw_response   JSON                            NULL                               COMMENT '모델 원본 응답(클래스별 확률 등)',
    is_latest      BOOLEAN                         NULL                               COMMENT '해당 제보의 최신 판별본이면 1, 과거본은 NULL',
    requested_at   DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '판별 요청 시각(UTC)',
    processed_at   DATETIME                        NULL                               COMMENT '판별 완료 시각(UTC)',
    CONSTRAINT pk_vision_results PRIMARY KEY (id),
    CONSTRAINT uk_vision_results_latest UNIQUE (report_id, is_latest),
    CONSTRAINT fk_vision_results_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE,
    CONSTRAINT ck_vision_results_result CHECK (result IS NULL OR result IN ('normal','toxic_suspected','unknown')),
    CONSTRAINT ck_vision_results_status CHECK (process_status IN ('pending','processing','done','failed')),
    CONSTRAINT ck_vision_results_conf CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT ck_vision_results_latest CHECK (is_latest IS NULL OR is_latest = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='제보 이미지 AI 판별 이력. SYS-004, AI-001, AI-003';


-- -------------------------------------------------------------------------------------
-- report_reviews : 관리자 제보 검수
--   - ADM-009: 확인완료/반려/보류. 반려 시 사유 필수.
--   - REPORT-003 반려 사유: not_jellyfish/unclear/duplicate/wrong_location/inappropriate
--   - 보류 후 재검수가 가능하므로 제보당 1행이 아닌 이력 구조로 둔다.
-- -------------------------------------------------------------------------------------
CREATE TABLE report_reviews (
    id             BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '검수 PK',
    report_id      BIGINT                          NOT NULL                           COMMENT '제보 FK',
    review_status  VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '검수 결과: verified(확인완료)/rejected(반려)/hold(보류)',
    reject_reason  VARCHAR(30) COLLATE utf8mb4_bin NULL                               COMMENT '반려 사유. review_status=rejected 이면 필수',
    memo           VARCHAR(500)                    NULL                               COMMENT '검수 메모',
    reflected_risk BOOLEAN                         NOT NULL DEFAULT 0                 COMMENT '이 검수로 위험도 재산출이 트리거되었는지. FLOW-ADM-003 3단계',
    reviewed_by    BIGINT                          NOT NULL                           COMMENT '검수자 FK. AUTH-002 감사 로그 요건',
    reviewed_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '검수 시각(UTC)',
    CONSTRAINT pk_report_reviews PRIMARY KEY (id),
    KEY ix_report_reviews_report_time (report_id, reviewed_at DESC),
    KEY ix_report_reviews_reviewer (reviewed_by, reviewed_at DESC),
    CONSTRAINT fk_report_reviews_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE,
    CONSTRAINT fk_report_reviews_user FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_report_reviews_status CHECK (review_status IN ('verified','rejected','hold')),
    CONSTRAINT ck_report_reviews_reason CHECK (reject_reason IS NULL OR reject_reason IN ('not_jellyfish','unclear','duplicate','wrong_location','inappropriate')),
    CONSTRAINT ck_report_reviews_reject_requires_reason CHECK (review_status <> 'rejected' OR reject_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='관리자 제보 검수 이력. ADM-009, AI-002, REPORT-003';


-- =====================================================================================
-- 4. 위험도 산출 (SYS-003 룰 엔진 / RISK-001~005)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- risk_rule_configs : 위험도 룰 설정
--   - 03_Data_AI 점수표를 그대로 담는다. ADM-012 는 조회 전용(P2).
--   - RULE_FORMULA: min(100, 위험 변수 점수 합계 + 제보 가중치)
--   - rule_code + version 으로 이력을 관리하고, 산출 시점의 version 을 risk_scores 에 남긴다.
-- -------------------------------------------------------------------------------------
CREATE TABLE risk_rule_configs (
    id             BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '룰 설정 PK',
    rule_code      VARCHAR(50)                     NOT NULL                           COMMENT '룰 코드 (예: TEMP_UP, REPORT_TOXIC, MIN_TOXIC_STING)',
    rule_category  VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '분류: risk_variable(위험 변수)/report_weight(제보 가중치)/level_threshold(단계 구간)/min_level(최소 단계 보장)',
    rule_name      VARCHAR(150)                    NOT NULL                           COMMENT '룰 명칭',
    score          SMALLINT                        NULL                               COMMENT '가산 점수. level_threshold/min_level 은 NULL',
    condition_json JSON                            NULL                               COMMENT '적용 조건(임계값 등). 예: {"threshold_c": 1.5, "window_days": 3}',
    min_risk_level VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT 'min_level 룰의 보장 단계. MIN_TOXIC_1=caution, MIN_TOXIC_HIGH=danger, MIN_TOXIC_STING=severe',
    version        VARCHAR(20)                     NOT NULL DEFAULT 'v1'              COMMENT '룰 버전',
    active         BOOLEAN                         NOT NULL DEFAULT 1                 COMMENT '적용 여부',
    updated_by     BIGINT                          NULL                               COMMENT '최종 수정자 FK',
    created_at     DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    updated_at     DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_risk_rule_configs PRIMARY KEY (id),
    CONSTRAINT uk_risk_rule_configs_code_version UNIQUE (rule_code, version),
    CONSTRAINT fk_risk_rule_configs_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_risk_rule_configs_category CHECK (rule_category IN ('risk_variable','report_weight','level_threshold','min_level')),
    CONSTRAINT ck_risk_rule_configs_score CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    CONSTRAINT ck_risk_rule_configs_min_level CHECK (min_risk_level IS NULL OR min_risk_level IN ('safe','caution','danger','severe'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='위험도 룰/점수표 설정. SYS-003, ADM-012, RULE_FORMULA';


-- -------------------------------------------------------------------------------------
-- risk_calculations : 위험도 산출 배치 실행 단위
--   - POST /system/risk/calculate 의 calculationId 에 대응
--   - RECALC_BATCH 트리거: 공공데이터 갱신 / 제보 확인완료 / 반려·보류 변경 / 수동 실행
--   - 산출 실패 시 로그를 남기고 이전 risk_scores 를 유지한다(RISK_OUTPUT 결측 처리).
-- -------------------------------------------------------------------------------------
CREATE TABLE risk_calculations (
    id                   BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '산출 실행 PK',
    calculation_uid      VARCHAR(50)                     NOT NULL                           COMMENT '외부 노출용 산출 ID (예: calc_001)',
    trigger_type         VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '트리거: schedule/data_sync/report_verified/manual',
    trigger_report_id    BIGINT                          NULL                               COMMENT '제보 검수로 트리거된 경우 해당 제보 FK',
    triggered_by         BIGINT                          NULL                               COMMENT '수동 실행자 FK. 배치는 NULL',
    rule_version         VARCHAR(20)                     NOT NULL                           COMMENT '적용한 룰 버전',
    affected_beach_count INT                             NOT NULL DEFAULT 0                 COMMENT '산출 대상 해변 수',
    calc_status          VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'running'         COMMENT '실행 상태: running/success/partial/failed',
    error_message        VARCHAR(500)                    NULL                               COMMENT '실패 사유',
    started_at           DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '시작 시각(UTC)',
    finished_at          DATETIME                        NULL                               COMMENT '종료 시각(UTC)',
    CONSTRAINT pk_risk_calculations PRIMARY KEY (id),
    CONSTRAINT uk_risk_calculations_uid UNIQUE (calculation_uid),
    CONSTRAINT fk_risk_calculations_report FOREIGN KEY (trigger_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL,
    CONSTRAINT fk_risk_calculations_user FOREIGN KEY (triggered_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_risk_calculations_trigger CHECK (trigger_type IN ('schedule','data_sync','report_verified','manual')),
    CONSTRAINT ck_risk_calculations_status CHECK (calc_status IN ('running','success','partial','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='위험도 산출 배치 실행 이력. SYS-003, RECALC_BATCH';


-- -------------------------------------------------------------------------------------
-- risk_scores : 위험도 산출 결과 (해변 × 예측 시점)
--   - RISK-001 점수 구간: 0~30 safe / 31~55 caution / 56~75 danger / 76~100 severe
--   - RISK-002 최소 단계 보장(override) 적용 여부를 별도 컬럼으로 남겨 감사 가능하게 한다.
--   - RISK-005 data_confidence: high/medium/low
--   - is_latest 트릭: 값이 1 또는 NULL 이며 UNIQUE(beach_id, horizon, is_latest) 로
--     "해변·시점별 최신 1건"을 DB가 보장한다. MySQL 은 NULL 중복을 허용하므로 과거본은 NULL.
-- -------------------------------------------------------------------------------------
CREATE TABLE risk_scores (
    id                  BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '위험도 PK',
    calculation_id      BIGINT                          NOT NULL                           COMMENT '산출 실행 FK',
    beach_id            BIGINT                          NOT NULL                           COMMENT '해수욕장 FK',
    horizon             VARCHAR(10) COLLATE utf8mb4_bin NOT NULL                           COMMENT '예측 시점: now/6h(2차)/24h/72h',
    risk_score          SMALLINT                        NOT NULL                           COMMENT '위험 점수 0~100. min(100, 변수합 + 제보 가중치)',
    risk_level          VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '위험 단계: safe/caution/danger/severe',
    base_risk_level     VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '최소 단계 보장 적용 전 원점수 기준 단계. 감사용',
    min_level_applied   BOOLEAN                         NOT NULL DEFAULT 0                 COMMENT 'RISK-002 override 적용 여부',
    min_level_rule_code VARCHAR(50)                     NULL                               COMMENT '적용된 최소 단계 룰 코드 (MIN_TOXIC_1/MIN_TOXIC_HIGH/MIN_TOXIC_STING)',
    data_confidence     VARCHAR(10) COLLATE utf8mb4_bin NOT NULL DEFAULT 'medium'          COMMENT '데이터 신뢰도: high/medium/low. G-004 배지',
    rule_version        VARCHAR(20)                     NOT NULL                           COMMENT '산출에 사용한 룰 버전',
    model_id            BIGINT                          NULL                               COMMENT '2차 ML 모델 FK. 룰 기반 산출이면 NULL (FK는 파일 하단에서 추가)',
    is_latest           BOOLEAN                         NULL                               COMMENT '최신 산출본이면 1, 과거본은 NULL',
    generated_at        DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '예측 생성 시각(UTC). G-004 노출 대상',
    CONSTRAINT pk_risk_scores PRIMARY KEY (id),
    CONSTRAINT uk_risk_scores_latest UNIQUE (beach_id, horizon, is_latest),
    KEY ix_risk_scores_calculation (calculation_id),
    CONSTRAINT fk_risk_scores_calculation FOREIGN KEY (calculation_id) REFERENCES risk_calculations (id) ON DELETE CASCADE,
    CONSTRAINT fk_risk_scores_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT ck_risk_scores_horizon CHECK (horizon IN ('now','6h','24h','72h')),
    CONSTRAINT ck_risk_scores_score CHECK (risk_score BETWEEN 0 AND 100),
    CONSTRAINT ck_risk_scores_level CHECK (risk_level IN ('safe','caution','danger','severe')),
    CONSTRAINT ck_risk_scores_base_level CHECK (base_risk_level IS NULL OR base_risk_level IN ('safe','caution','danger','severe')),
    CONSTRAINT ck_risk_scores_confidence CHECK (data_confidence IN ('high','medium','low')),
    CONSTRAINT ck_risk_scores_latest CHECK (is_latest IS NULL OR is_latest = 1),
    CONSTRAINT ck_risk_scores_min_level CHECK (min_level_applied = 0 OR min_level_rule_code IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해변×시점별 위험도 산출 결과. SYS-003, RISK-001, RISK-002, RISK_OUTPUT';


-- -------------------------------------------------------------------------------------
-- risk_factors : 위험 원인 태그
--   - ADM-005 / RISK-004: 관리자에게는 상세 원인, 관광객에게는 요약 원인을 3~5개 노출.
--   - 제보에서 파생된 요인(REPORT_*)은 source_report_id 로 추적한다.
--     ADM-009 반려 시 어떤 제보의 가중치를 제거해야 하는지 판단하기 위함.
-- -------------------------------------------------------------------------------------
CREATE TABLE risk_factors (
    id               BIGINT       NOT NULL AUTO_INCREMENT COMMENT '원인 태그 PK',
    risk_score_id    BIGINT       NOT NULL                COMMENT '위험도 FK',
    factor_code      VARCHAR(50)  NOT NULL                COMMENT '요인 코드. risk_rule_configs.rule_code 와 동일 체계',
    factor_name      VARCHAR(150) NOT NULL                COMMENT '노출 문구 (예: 최근 3일간 수온 상승)',
    factor_detail    VARCHAR(500) NULL                    COMMENT '원인 설명 툴팁 본문. ADM-005',
    score_delta      SMALLINT     NOT NULL                COMMENT '해당 요인이 더한 점수',
    source_report_id BIGINT       NULL                    COMMENT 'REPORT_* 요인의 근거 제보 FK',
    display_order    SMALLINT     NOT NULL DEFAULT 0      COMMENT '노출 순서. 상위 3~5개만 표시',
    CONSTRAINT pk_risk_factors PRIMARY KEY (id),
    KEY ix_risk_factors_score_order (risk_score_id, display_order),
    CONSTRAINT fk_risk_factors_score FOREIGN KEY (risk_score_id) REFERENCES risk_scores (id) ON DELETE CASCADE,
    CONSTRAINT fk_risk_factors_report FOREIGN KEY (source_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL,
    CONSTRAINT ck_risk_factors_delta CHECK (score_delta BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='위험도 산출 근거 태그. ADM-005, RISK-004';


-- =====================================================================================
-- 5. 운영 대응 (ADM-006 권고 확인 / ADM-007 상태 기록)
--    RISK-003: 위험도(예측)와 운영 상태(실제 조치)는 분리한다. 자동 통제가 아니라 수동 기록.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- operation_actions : 운영 대응 기록
--   - OP-002 필수값: beach_id, operation_status, created_by, created_at. memo 는 선택.
--   - OP-001 상태값 8종
-- -------------------------------------------------------------------------------------
CREATE TABLE operation_actions (
    id                BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '대응 기록 PK',
    beach_id          BIGINT                          NOT NULL                           COMMENT '대상 해수욕장 FK',
    risk_score_id     BIGINT                          NULL                               COMMENT '조치 근거가 된 위험도 FK. 위험도 없이 기록 가능하므로 NULL 허용',
    recommendation_id BIGINT                          NULL                               COMMENT '수락한 대응 권고 FK. 권고 없이 자체 판단한 조치면 NULL',
    action_type       VARCHAR(50)                     NULL                               COMMENT '조치 유형 코드. 값 확정은 CHECK-DEV 대상',
    operation_status  VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '기록된 운영 상태. OP-001 8종',
    memo              VARCHAR(500)                    NULL                               COMMENT '운영 메모(선택)',
    created_by        BIGINT                          NOT NULL                           COMMENT '기록자 FK. AUTH-002',
    created_at        DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '기록 시각(UTC)',
    CONSTRAINT pk_operation_actions PRIMARY KEY (id),
    KEY ix_operation_actions_beach_time (beach_id, created_at DESC),
    KEY ix_operation_actions_creator (created_by, created_at DESC),
    CONSTRAINT fk_operation_actions_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    CONSTRAINT fk_operation_actions_score FOREIGN KEY (risk_score_id) REFERENCES risk_scores (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_actions_recommendation FOREIGN KEY (recommendation_id) REFERENCES risk_recommendations (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_actions_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_operation_actions_status CHECK (operation_status IN (
        'normal','monitoring_up','entry_caution','lifeguard_added','broadcast',
        'zone_control_review','entry_ban','resumed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='운영자가 수행한 실제 조치 기록. ADM-007, OP-001, OP-002, RISK-003';


-- -------------------------------------------------------------------------------------
-- operation_status_logs : 운영 상태 변경 로그
--   - 감사/리포트용. 이전 상태 → 새 상태 전이를 남긴다.
-- -------------------------------------------------------------------------------------
CREATE TABLE operation_status_logs (
    id                  BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '상태 로그 PK',
    beach_id            BIGINT                          NOT NULL                           COMMENT '대상 해수욕장 FK',
    operation_action_id BIGINT                          NULL                               COMMENT '상태를 바꾼 대응 기록 FK',
    previous_status     VARCHAR(30) COLLATE utf8mb4_bin NULL                               COMMENT '이전 운영 상태. 최초 기록이면 NULL',
    new_status          VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '변경된 운영 상태',
    reason              VARCHAR(500)                    NULL                               COMMENT '변경 사유',
    changed_by          BIGINT                          NOT NULL                           COMMENT '변경자 FK',
    changed_at          DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '변경 시각(UTC)',
    CONSTRAINT pk_operation_status_logs PRIMARY KEY (id),
    KEY ix_operation_status_logs_beach_time (beach_id, changed_at DESC),
    CONSTRAINT fk_operation_status_logs_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    CONSTRAINT fk_operation_status_logs_action FOREIGN KEY (operation_action_id) REFERENCES operation_actions (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_status_logs_user FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_operation_status_logs_prev CHECK (previous_status IS NULL OR previous_status IN (
        'normal','monitoring_up','entry_caution','lifeguard_added','broadcast',
        'zone_control_review','entry_ban','resumed')),
    CONSTRAINT ck_operation_status_logs_new CHECK (new_status IN (
        'normal','monitoring_up','entry_caution','lifeguard_added','broadcast',
        'zone_control_review','entry_ban','resumed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='운영 상태 전이 로그. ADM-007 감사/리포트용';


-- =====================================================================================
-- 6. 알림 (SYS-005 위험 상승 알림 생성 / ADM-010 문구 생성)
--    NOTI-002: MVP 는 실제 Push/SMS 없이 인앱 알림함 + 문구 생성/복사만 제공한다.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- notification_templates : 알림 문구 템플릿
-- -------------------------------------------------------------------------------------
CREATE TABLE notification_templates (
    id            BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '템플릿 PK',
    template_code VARCHAR(50)                     NOT NULL                           COMMENT '템플릿 코드',
    target_type   VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '대상: admin/operator/public',
    risk_level    VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '적용 위험 단계. 단계 무관 템플릿은 NULL',
    event_type    VARCHAR(30) COLLATE utf8mb4_bin NULL                               COMMENT '적용 이벤트: level_up/toxic_report/sting_report',
    title         VARCHAR(200)                    NULL                               COMMENT '문구 제목',
    body          TEXT                            NOT NULL                           COMMENT '문구 본문. {beachName}, {riskLevel} 치환 변수 사용',
    active        BOOLEAN                         NOT NULL DEFAULT 1                 COMMENT '사용 여부',
    created_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    updated_at    DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_notification_templates PRIMARY KEY (id),
    CONSTRAINT uk_notification_templates_code UNIQUE (template_code),
    CONSTRAINT ck_notification_templates_target CHECK (target_type IN ('admin','operator','public')),
    CONSTRAINT ck_notification_templates_level CHECK (risk_level IS NULL OR risk_level IN ('safe','caution','danger','severe')),
    CONSTRAINT ck_notification_templates_event CHECK (event_type IS NULL OR event_type IN ('level_up','toxic_report','sting_report'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='알림/안내방송 문구 템플릿. ADM-010';


-- -------------------------------------------------------------------------------------
-- notifications : 알림함 / 알림 로그
--   - NOTI-001 생성 조건: 단계 상승(level_up), 독성 의심 제보(toxic_report), 쏘임 사고(sting_report)
--   - NOTI-003 피로도 방지: 동일 해변·동일 단계 반복 생성 금지. dedup_key + cooldown_until 로 제어.
--   - 대상 식별은 로그인 사용자(target_user_id)와 비로그인 토큰(target_user_token)으로 분리했다.
-- -------------------------------------------------------------------------------------
CREATE TABLE notifications (
    id                BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '알림 PK',
    target_type       VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '대상 구분: admin/operator/public',
    target_user_id    BIGINT                          NULL                               COMMENT '대상 사용자 FK. 브로드캐스트(전체 관리자)면 NULL',
    target_user_token VARCHAR(64)                     NULL                               COMMENT '비로그인 관심 해변 사용자 토큰. USR-003',
    beach_id          BIGINT                          NOT NULL                           COMMENT '대상 해수욕장 FK',
    risk_level        VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '알림 시점 위험 단계',
    event_type        VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '발생 이벤트: level_up/toxic_report/sting_report',
    template_id       BIGINT                          NULL                               COMMENT '사용한 템플릿 FK',
    message           TEXT                            NOT NULL                           COMMENT '치환 완료된 최종 문구',
    dedup_key         VARCHAR(150)                    NULL                               COMMENT '중복 방지 키 (예: beachId:eventType:riskLevel:yyyyMMddHH). NOTI-003',
    cooldown_until    DATETIME                        NULL                               COMMENT '이 키로 재생성이 금지되는 시각(UTC)',
    created_at        DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    read_at           DATETIME                        NULL                               COMMENT '열람 시각(UTC). 미열람이면 NULL',
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT uk_notifications_dedup UNIQUE (dedup_key),
    KEY ix_notifications_user_read (target_user_id, read_at, created_at DESC),
    KEY ix_notifications_beach_time (beach_id, created_at DESC),
    CONSTRAINT fk_notifications_user FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_template FOREIGN KEY (template_id) REFERENCES notification_templates (id) ON DELETE SET NULL,
    CONSTRAINT ck_notifications_target CHECK (target_type IN ('admin','operator','public')),
    CONSTRAINT ck_notifications_level CHECK (risk_level IS NULL OR risk_level IN ('safe','caution','danger','severe')),
    CONSTRAINT ck_notifications_event CHECK (event_type IN ('level_up','toxic_report','sting_report'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='인앱 알림함/알림 로그. SYS-005, NOTI-001~003. Push 아님';


-- =====================================================================================
-- 7. 리포트 (ADM-011 일간 운영 리포트 / SYS-006 자동 요약)
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- daily_reports : 일간 운영 리포트
--   - 운영일 기준으로 위험도 변화, 제보 수, 검수 결과, 대응 기록, 사고 여부를 집계한다.
--   - MVP 는 화면 요약. PDF/시즌 리포트는 2차.
-- -------------------------------------------------------------------------------------
CREATE TABLE daily_reports (
    id                  BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '일간 리포트 PK',
    beach_id            BIGINT                          NOT NULL                           COMMENT '대상 해수욕장 FK',
    report_date         DATE                            NOT NULL                           COMMENT '운영일(KST 기준 날짜). 원본 문서의 date 컬럼',
    summary_json        JSON                            NULL                               COMMENT '요약 원문. 위험도 변화/주요 원인/집계 상세',
    max_risk_level      VARCHAR(20) COLLATE utf8mb4_bin NULL                            COMMENT '당일 최고 위험 단계',
    risk_change_summary VARCHAR(200)                    NULL                           COMMENT '위험도 변화 요약 (예: 주의→위험)',
    report_count        INT                             NOT NULL DEFAULT 0                 COMMENT '당일 제보 수',
    toxic_count         INT                             NOT NULL DEFAULT 0                 COMMENT '독성 의심 제보 수',
    sting_count         INT                             NOT NULL DEFAULT 0                 COMMENT '쏘임 사고 수',
    action_count        INT                             NOT NULL DEFAULT 0                 COMMENT '대응 기록 수',
    memo                TEXT                            NULL                               COMMENT '운영자 특이사항/후속 조치 메모. FLOW-ADM-004',
    created_by          BIGINT                          NULL                               COMMENT '작성자 FK. 자동 생성(SYS-006)이면 NULL',
    created_at          DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    updated_at          DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각(UTC)',
    CONSTRAINT pk_daily_reports PRIMARY KEY (id),
    CONSTRAINT uk_daily_reports_beach_date UNIQUE (beach_id, report_date),
    CONSTRAINT fk_daily_reports_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_daily_reports_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_daily_reports_level CHECK (max_risk_level IS NULL OR max_risk_level IN ('safe','caution','danger','severe'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='해변별 일간 운영 리포트. ADM-011, SYS-006';


-- =====================================================================================
-- 8. 사용자 부가 기능 / 감사
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- favorite_beaches : 관심 해변
--   - USR-003: MVP 는 비로그인 로컬/세션 저장 허용. 계정 기반 저장은 2차.
--     서버 저장 시 user_id 또는 user_token 중 하나는 반드시 있어야 한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE favorite_beaches (
    id         BIGINT      NOT NULL AUTO_INCREMENT            COMMENT '관심 해변 PK',
    user_id    BIGINT      NULL                               COMMENT '로그인 사용자 FK',
    user_token VARCHAR(64) NULL                               COMMENT '비로그인 사용자 토큰',
    beach_id   BIGINT      NOT NULL                           COMMENT '해수욕장 FK',
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '저장 시각(UTC)',
    CONSTRAINT pk_favorite_beaches PRIMARY KEY (id),
    CONSTRAINT uk_favorite_beaches_user UNIQUE (user_id, beach_id),
    CONSTRAINT uk_favorite_beaches_token UNIQUE (user_token, beach_id),
    CONSTRAINT fk_favorite_beaches_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_favorite_beaches_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT ck_favorite_beaches_subject CHECK (user_id IS NOT NULL OR user_token IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='관심 해변 저장. USR-003';


-- -------------------------------------------------------------------------------------
-- audit_logs : 관리자 액션 감사 로그
--   - AUTH-002: 제보 검수, 대응 기록, 상태 변경 시 사용자·시각·변경 내용을 남긴다.
--   - 사용자 삭제 시에도 로그는 보존해야 하므로 user_id 는 ON DELETE SET NULL.
-- -------------------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGINT      NOT NULL AUTO_INCREMENT            COMMENT '감사 로그 PK',
    user_id     BIGINT      NULL                               COMMENT '행위자 FK. 계정 삭제 시 NULL 로 보존',
    action_type VARCHAR(50) NOT NULL                           COMMENT '액션 유형 (예: REVIEW_REPORT, RECORD_ACTION, CHANGE_STATUS)',
    target_type VARCHAR(50) NOT NULL                           COMMENT '대상 엔터티명 (예: jellyfish_reports)',
    target_id   BIGINT      NULL                               COMMENT '대상 레코드 PK',
    before_json JSON        NULL                               COMMENT '변경 전 스냅샷',
    after_json  JSON        NULL                               COMMENT '변경 후 스냅샷',
    ip_address  VARCHAR(45) NULL                               COMMENT '행위자 IP',
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '기록 시각(UTC)',
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    KEY ix_audit_logs_user_time (user_id, created_at DESC),
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='관리자/운영자 액션 감사 로그. AUTH-002';


-- =====================================================================================
-- 9. 2차 확장 (EX-001 관광 플랫폼 / EX-002 Push·SMS / EX-003 ML / EX-004 어민·양식장 구독)
--    ※ MVP-002 상 1차 구현 범위 밖. ERD 상 확장 지점을 명시하기 위해 정의한다.
--       기능정의서에 컬럼 정의가 없어 설계자가 채운 영역이므로 착수 전 재검토 필요.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- notification_consents : 알림 수신 동의 (EX-002)
-- -------------------------------------------------------------------------------------
CREATE TABLE notification_consents (
    id           BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '수신 동의 PK',
    user_id      BIGINT                          NULL                               COMMENT '로그인 사용자 FK',
    user_token   VARCHAR(64)                     NULL                               COMMENT '비로그인 사용자 토큰',
    channel      VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '채널: push/sms/email',
    agreed       BOOLEAN                         NOT NULL DEFAULT 0                 COMMENT '수신 동의 여부',
    phone_number VARCHAR(30)                     NULL                               COMMENT 'SMS 수신 번호(암호화 저장 권장)',
    device_token VARCHAR(255)                    NULL                               COMMENT 'Push 디바이스 토큰',
    agreed_at    DATETIME                        NULL                               COMMENT '동의 시각(UTC)',
    revoked_at   DATETIME                        NULL                               COMMENT '수신 거부 시각(UTC)',
    CONSTRAINT pk_notification_consents PRIMARY KEY (id),
    CONSTRAINT fk_notification_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_consents_channel CHECK (channel IN ('push','sms','email')),
    CONSTRAINT ck_notification_consents_subject CHECK (user_id IS NOT NULL OR user_token IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 알림 수신 동의. EX-002';


-- -------------------------------------------------------------------------------------
-- notification_dispatches : 실제 Push/SMS 발송 이력 (EX-002)
-- -------------------------------------------------------------------------------------
CREATE TABLE notification_dispatches (
    id              BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '발송 이력 PK',
    notification_id BIGINT                          NOT NULL                           COMMENT '알림 FK',
    channel         VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '발송 채널: push/sms/email',
    provider        VARCHAR(50)                     NULL                               COMMENT '발송 대행사 (예: FCM, NHN Cloud)',
    recipient       VARCHAR(255)                    NOT NULL                           COMMENT '수신자 식별자(번호/디바이스 토큰). 마스킹 저장 권장',
    dispatch_status VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending'         COMMENT '발송 상태: pending/sent/failed/rejected',
    failed_reason   VARCHAR(500)                    NULL                               COMMENT '실패/거부 사유',
    retry_count     SMALLINT                        NOT NULL DEFAULT 0                 COMMENT '재시도 횟수',
    cost_amount     DECIMAL(10,2)                   NULL                               COMMENT '건당 발송 비용',
    sent_at         DATETIME                        NULL                               COMMENT '발송 시각(UTC)',
    created_at      DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_notification_dispatches PRIMARY KEY (id),
    CONSTRAINT fk_notification_dispatches_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
    CONSTRAINT ck_notification_dispatches_channel CHECK (channel IN ('push','sms','email')),
    CONSTRAINT ck_notification_dispatches_status CHECK (dispatch_status IN ('pending','sent','failed','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 외부 채널 발송 이력. EX-002. MVP 에서는 사용하지 않음';


-- -------------------------------------------------------------------------------------
-- partners : 관광 플랫폼 제휴사 (EX-001)
-- -------------------------------------------------------------------------------------
CREATE TABLE partners (
    id             BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '제휴사 PK',
    partner_code   VARCHAR(50)                     NOT NULL                           COMMENT '제휴사 코드',
    name           VARCHAR(150)                    NOT NULL                           COMMENT '제휴사명',
    business_no    VARCHAR(30)                     NULL                               COMMENT '사업자등록번호',
    contact_name   VARCHAR(100)                    NULL                               COMMENT '담당자명',
    contact_email  VARCHAR(255)                    NULL                               COMMENT '담당자 이메일',
    plan_code      VARCHAR(30)                     NULL                               COMMENT '과금 플랜 코드',
    partner_status VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'active'          COMMENT '상태: active/suspended/terminated',
    created_at     DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_partners PRIMARY KEY (id),
    CONSTRAINT uk_partners_code UNIQUE (partner_code),
    CONSTRAINT ck_partners_status CHECK (partner_status IN ('active','suspended','terminated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 관광 플랫폼 제휴사. EX-001';


-- -------------------------------------------------------------------------------------
-- partner_api_keys : 제휴사 API 키 (EX-001)
-- -------------------------------------------------------------------------------------
CREATE TABLE partner_api_keys (
    id                 BIGINT       NOT NULL AUTO_INCREMENT            COMMENT 'API 키 PK',
    partner_id         BIGINT       NOT NULL                           COMMENT '제휴사 FK',
    key_prefix         VARCHAR(16)  NOT NULL                           COMMENT '키 식별용 접두어(콘솔 노출용)',
    api_key_hash       VARCHAR(255) NOT NULL                           COMMENT 'API 키 해시. 평문 저장 금지',
    scopes_json        JSON         NULL                               COMMENT '허용 스코프 목록',
    rate_limit_per_min INT          NULL                               COMMENT '분당 호출 제한',
    expires_at         DATETIME     NULL                               COMMENT '만료 시각(UTC)',
    revoked_at         DATETIME     NULL                               COMMENT '폐기 시각(UTC)',
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_partner_api_keys PRIMARY KEY (id),
    CONSTRAINT uk_partner_api_keys_prefix UNIQUE (key_prefix),
    CONSTRAINT fk_partner_api_keys_partner FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 제휴사 API 키. EX-001';


-- -------------------------------------------------------------------------------------
-- partner_api_call_logs : 제휴사 API 호출/과금 로그 (EX-001)
-- -------------------------------------------------------------------------------------
CREATE TABLE partner_api_call_logs (
    id               BIGINT       NOT NULL AUTO_INCREMENT            COMMENT '호출 로그 PK',
    partner_id       BIGINT       NOT NULL                           COMMENT '제휴사 FK',
    api_key_id       BIGINT       NULL                               COMMENT '사용된 API 키 FK',
    endpoint         VARCHAR(255) NOT NULL                           COMMENT '호출 엔드포인트',
    http_method      VARCHAR(10)  NOT NULL                           COMMENT 'HTTP 메서드',
    status_code      SMALLINT     NOT NULL                           COMMENT 'HTTP 응답 코드',
    response_time_ms INT          NULL                               COMMENT '응답 시간(ms)',
    is_billable      BOOLEAN      NOT NULL DEFAULT 1                 COMMENT '과금 대상 여부',
    called_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '호출 시각(UTC)',
    CONSTRAINT pk_partner_api_call_logs PRIMARY KEY (id),
    KEY ix_partner_api_call_logs_partner_time (partner_id, called_at DESC),
    CONSTRAINT fk_partner_api_call_logs_partner FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE,
    CONSTRAINT fk_partner_api_call_logs_key FOREIGN KEY (api_key_id) REFERENCES partner_api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 제휴사 API 호출/과금 로그. EX-001';


-- -------------------------------------------------------------------------------------
-- ml_models : 고도화 예측 모델 (EX-003)
--   - 1차는 룰 기반 + Mock AI. 데이터 축적 후 LightGBM 등으로 고도화.
-- -------------------------------------------------------------------------------------
CREATE TABLE ml_models (
    id               BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '모델 PK',
    model_name       VARCHAR(100)                    NOT NULL                           COMMENT '모델명',
    version          VARCHAR(30)                     NOT NULL                           COMMENT '모델 버전',
    algorithm        VARCHAR(50)                     NULL                               COMMENT '알고리즘 (예: lightgbm)',
    model_purpose    VARCHAR(30) COLLATE utf8mb4_bin NOT NULL                           COMMENT '용도: risk_prediction(위험도 예측)/vision(이미지 판별)',
    hyperparams_json JSON                            NULL                               COMMENT '하이퍼파라미터',
    metrics_json     JSON                            NULL                               COMMENT '성능 지표(accuracy, f1 등)',
    artifact_uri     VARCHAR(500)                    NULL                               COMMENT '모델 아티팩트 저장 경로',
    model_status     VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'training'        COMMENT '상태: training/staging/active/archived',
    trained_at       DATETIME                        NULL                               COMMENT '학습 완료 시각(UTC)',
    activated_at     DATETIME                        NULL                               COMMENT '서비스 적용 시각(UTC)',
    created_at       DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_ml_models PRIMARY KEY (id),
    CONSTRAINT uk_ml_models_name_version UNIQUE (model_name, version),
    CONSTRAINT ck_ml_models_purpose CHECK (model_purpose IN ('risk_prediction','vision')),
    CONSTRAINT ck_ml_models_status CHECK (model_status IN ('training','staging','active','archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] ML 모델 레지스트리. EX-003';


-- -------------------------------------------------------------------------------------
-- subscriptions : 어민/양식장 위험 알림 구독 (EX-004)
-- -------------------------------------------------------------------------------------
CREATE TABLE subscriptions (
    id                  BIGINT                          NOT NULL AUTO_INCREMENT            COMMENT '구독 PK',
    user_id             BIGINT                          NOT NULL                           COMMENT '구독자 FK',
    subscriber_type     VARCHAR(20) COLLATE utf8mb4_bin NOT NULL                           COMMENT '구독자 유형: fisherman(어민)/aquafarm(양식장)',
    plan_code           VARCHAR(30)                     NOT NULL                           COMMENT '요금제 코드',
    subscription_status VARCHAR(20) COLLATE utf8mb4_bin NOT NULL DEFAULT 'pending'         COMMENT '상태: pending/active/paused/canceled/expired',
    price_amount        DECIMAL(10,2)                   NULL                               COMMENT '구독 금액',
    payment_status      VARCHAR(20) COLLATE utf8mb4_bin NULL                               COMMENT '결제 상태: unpaid/paid/refunded',
    started_at          DATETIME                        NULL                               COMMENT '구독 시작 시각(UTC)',
    expires_at          DATETIME                        NULL                               COMMENT '구독 만료 시각(UTC)',
    created_at          DATETIME                        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_subscriptions PRIMARY KEY (id),
    KEY ix_subscriptions_user_status (user_id, subscription_status),
    CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_subscriptions_type CHECK (subscriber_type IN ('fisherman','aquafarm')),
    CONSTRAINT ck_subscriptions_status CHECK (subscription_status IN ('pending','active','paused','canceled','expired')),
    CONSTRAINT ck_subscriptions_payment CHECK (payment_status IS NULL OR payment_status IN ('unpaid','paid','refunded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 어민/양식장 구독. EX-004';


-- -------------------------------------------------------------------------------------
-- subscription_areas : 구독 담당 해역 (EX-004)
--   - 해수욕장 기준 또는 임의 좌표 반경 기준 중 하나로 지정한다.
-- -------------------------------------------------------------------------------------
CREATE TABLE subscription_areas (
    id              BIGINT        NOT NULL AUTO_INCREMENT            COMMENT '담당 해역 PK',
    subscription_id BIGINT        NOT NULL                           COMMENT '구독 FK',
    beach_id        BIGINT        NULL                               COMMENT '해수욕장 기준 구독 시 FK',
    label           VARCHAR(100)  NULL                               COMMENT '해역 명칭 (예: 한림 앞바다 가두리)',
    center_lat      DECIMAL(10,7) NULL                               COMMENT '임의 해역 중심 위도',
    center_lng      DECIMAL(10,7) NULL                               COMMENT '임의 해역 중심 경도',
    radius_km       DECIMAL(6,2)  NULL                               COMMENT '알림 반경(km)',
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각(UTC)',
    CONSTRAINT pk_subscription_areas PRIMARY KEY (id),
    CONSTRAINT fk_subscription_areas_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE,
    CONSTRAINT fk_subscription_areas_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT ck_subscription_areas_target CHECK (
        beach_id IS NOT NULL OR (center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_km IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='[2차] 구독 담당 해역. EX-004';


-- -------------------------------------------------------------------------------------
-- 지연 FK : risk_scores → ml_models (2차 테이블이 뒤에 정의되므로 여기서 추가)
-- -------------------------------------------------------------------------------------
ALTER TABLE risk_scores
    ADD CONSTRAINT fk_risk_scores_model FOREIGN KEY (model_id) REFERENCES ml_models (id) ON DELETE SET NULL;


-- =====================================================================================
-- 보조 인덱스
--   원칙 1) PK/UK 로 이미 커버되는 경로는 만들지 않는다.
--   원칙 2) FK 컬럼을 선두로 하는 복합 인덱스는 CREATE TABLE 안에 KEY 로 선언했다.
--           MySQL 은 FK 컬럼을 선두로 하는 인덱스가 없으면 CREATE TABLE 시점에
--           단일 컬럼 인덱스를 자동 생성한다. 나중에 CREATE INDEX 로 복합 인덱스를 추가해도
--           자동 생성분은 남으므로 중복 인덱스가 된다.
--   아래에는 FK 로 시작하지 않는 조회 경로만 남긴다.
-- =====================================================================================

-- GET /admin/risks/latest : 위험 단계 필터, 대시보드 집계
CREATE INDEX ix_risk_scores_level ON risk_scores (risk_level, generated_at DESC);

-- GET /admin/reports : status / aiResult 필터 + 접수 시각 정렬
CREATE INDEX ix_jellyfish_reports_status_time ON jellyfish_reports (status, submitted_at DESC);
CREATE INDEX ix_jellyfish_reports_ai_result   ON jellyfish_reports (ai_result, submitted_at DESC);
-- REPORT-004 중복 후보 탐지 : 동일 해변 + 짧은 시간 윈도우 + 유사 상태
CREATE INDEX ix_jellyfish_reports_dup_window  ON jellyfish_reports (beach_id, occurred_at, report_type);
-- REPORT-004 동일 사용자 반복 제보 탐지
CREATE INDEX ix_jellyfish_reports_reporter    ON jellyfish_reports (reporter_token, submitted_at DESC);

-- SYS-004 미처리 판별 큐 스캔
CREATE INDEX ix_vision_results_status ON vision_results (process_status, requested_at);

-- PAST_OCCURRENCE(동일 시기·구역), NEARBY_ALERT(인근 해역 속보)
CREATE INDEX ix_jellyfish_occurrences_time_region ON jellyfish_occurrences (occurred_at DESC, region);
CREATE INDEX ix_jellyfish_occurrences_geo         ON jellyfish_occurrences (lat, lng);

-- GET /public/alerts : 비로그인 관심 해변 사용자의 미열람 알림함
CREATE INDEX ix_notifications_token_read ON notifications (target_user_token, read_at, created_at DESC);

-- GET /admin/daily-reports : date 단독 조회 (beach_id 미지정 시)
CREATE INDEX ix_daily_reports_date ON daily_reports (report_date DESC);

-- AUTH-002 대상 레코드 기준 감사 추적
CREATE INDEX ix_audit_logs_target ON audit_logs (target_type, target_id, created_at DESC);

-- 비로그인 사용자의 동의 이력 조회
CREATE INDEX ix_consent_logs_token ON consent_logs (user_token, agreed_at DESC);

-- ADM-012 활성 룰 조회
CREATE INDEX ix_risk_rule_configs_active ON risk_rule_configs (active, rule_category);

-- 최근 산출 배치 이력
CREATE INDEX ix_risk_calculations_time ON risk_calculations (started_at DESC);

-- [2차]
CREATE INDEX ix_notification_dispatches_status ON notification_dispatches (dispatch_status, created_at DESC);


-- =====================================================================================
-- [설계 노트] 기능정의서 원본 대비 변경/보완 사항
-- =====================================================================================
--
--  A. 원본 컬럼을 그대로 쓰지 않고 조정한 항목
--
--   A-1. jellyfish_reports.consent_id  →  report_consents 브릿지 테이블
--        04_API_DB 는 단일 consent_id 였으나, POST /public/reports 의 요청 필드가
--        consentIds(복수)이고 PRIV-001 이 개인정보·위치정보 동의를 각각 요구하므로 1:N 으로 정규화.
--
--   A-2. daily_reports.date  →  report_date
--        MySQL 에서 date 는 함수명과 충돌하기 쉬워 백틱 없이 쓰기 곤란. 의미는 동일.
--
--   A-3. notifications.target_id  →  target_user_id(FK) + target_user_token
--        원본은 polymorphic 단일 컬럼이었다. 관광객은 비로그인 토큰, 관리자/운영자는 계정이라
--        FK 무결성을 살리려면 분리가 맞다. 브로드캐스트(전체 관리자)는 둘 다 NULL.
--
--   A-4. jellyfish_reports.ai_result / ai_confidence 는 vision_results 최신값의 비정규화 사본이다.
--        GET /admin/reports 가 aiResult 로 필터링/정렬하므로 조인 없이 읽기 위함.
--        원본(재시도·모델 교체 이력)은 vision_results 에 남는다. 쓰기 시 양쪽 동기화 필요.
--
--   A-5. operation_actions.action_type 은 CHECK 를 걸지 않았다.
--        04_API_DB 에 컬럼만 있고 값 목록이 없다. CHECK-DEV 항목으로 확정 후 제약 추가할 것.
--        대신 recommendation_id FK 를 두어 ADM-006 권고와 ADM-007 기록을 연결했다.
--
--   A-6. consent_logs.user_id / jellyfish_reports.reporter_user_id 는 ON DELETE RESTRICT 다.
--        원래 SET NULL 로 두려 했으나 MySQL 8 은 SET NULL 참조 액션이 걸린 컬럼을
--        CHECK 제약식에 사용하지 못한다(ERROR 3823). 두 컬럼은 "user_id 또는 user_token 중
--        하나는 반드시 있어야 한다"는 CHECK 의 피연산자다.
--        게다가 SET NULL 이 실제로 동작하면 로그인 제보자의 reporter_user_id 가 NULL 이 되면서
--        그 CHECK 자체를 위반한다. 즉 SET NULL 은 논리적으로도 틀린 선택이었다.
--        계정 삭제 시에는 앱에서 reporter_token 을 채워 익명화한 뒤 삭제할 것.
--        (audit_logs.user_id 는 CHECK 피연산자가 아니므로 SET NULL 을 그대로 유지했다)
--
--  B. 문서에 이름만 있고 컬럼 정의가 없어 신규 설계한 테이블
--
--        data_sources, observation_stations, observations, observation_mappings,
--        jellyfish_occurrences, vision_results, static_guides, risk_recommendations,
--        risk_calculations, report_consents
--        + [2차] notification_consents, notification_dispatches, partners, partner_api_keys,
--                partner_api_call_logs, ml_models, subscriptions, subscription_areas
--
--        - observation_stations 는 SYS-002 "최근접 관측소 매핑"을 위해 필수인데 문서에 누락되어 추가.
--        - jellyfish_occurrences 는 사용자 제보(jellyfish_reports)와 별개다.
--          전자는 공공데이터(PAST_OCCURRENCE, NEARBY_ALERT 입력), 후자는 제보(REPORT_* 가중치).
--          03_Data_AI 의 "공공데이터 대체 아님" 원칙을 스키마 레벨에서 분리했다.
--        - risk_calculations 는 POST /system/risk/calculate 의 calculationId 응답과
--          RECALC_BATCH 의 "버전/생성시각 저장" 요건을 만족시키기 위한 실행 단위 테이블.
--
--  B-2. 상태값 컬럼 46개에 COLLATE utf8mb4_bin 적용 (파일 상단 ★ 항목 참조)
--        DB 기본 콜레이션이 대소문자를 무시하므로 bin 콜레이션 없이는
--        risk_level='DANGER', status='RECEIVED' 같은 값이 CHECK 를 통과해 저장된다.
--        JPA @Enumerated(EnumType.STRING) 사용 시 실제로 발생하는 사고다.
--
--  C. "1 또는 NULL" 플래그 트릭
--        risk_scores.is_latest, vision_results.is_latest, observation_mappings.is_primary
--        MySQL 은 UNIQUE 인덱스에서 NULL 중복을 허용한다. 이를 이용해
--        "대표 행만 1, 나머지는 NULL" 로 두면 UNIQUE(beach_id, horizon, is_latest) 만으로
--        해변×시점별 최신 레코드가 두 건 존재하는 사고를 DB가 막아준다.
--        CHECK (is_latest IS NULL OR is_latest = 1) 로 0 이 들어오는 것도 차단했다.
--        갱신 시에는 기존 행을 NULL 로 내리고 새 행을 1 로 올리는 순서를 트랜잭션으로 묶을 것.
--        (0/1 플래그였다면 UNIQUE 가 무의미해져 최신본 2건이 조용히 생길 수 있다)
--
--  D. 착수 전 확정 필요 (05_Flow_검수 CHECK-FINAL)
--        - PRIV-003 보관 기간: jellyfish_reports.purge_scheduled_at, consent_logs.expires_at 의 산정 규칙
--        - 위험도 점수표: risk_rule_configs 초기 시드 값 (03_Data_AI 기준값 사용)
--        - horizon 에 '6h' 를 포함해두었으나 ADM-004 상 2차 항목
--        - 관리자 계정 범위: MVP 는 operator/admin 통합 계정 허용 (AUTH-001 비고)
--        - operation_actions.action_type 값 목록
--
-- =====================================================================================
