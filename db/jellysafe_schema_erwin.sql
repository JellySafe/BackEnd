-- =====================================================================================
--  JellySafe - ERwin Reverse Engineering (Script File) Import DDL
--  Generated from : jellysafe_schema.sql
--  Target Database: MySQL 8.x   <- ERwin 의 Target Database 를 MySQL 로 지정할 것
--
--  ERwin 의 MySQL 스크립트 파서가 처리하지 못하는 구문을 제거한 버전이다.
--  제거: SET / DROP TABLE / 주석 / COMMENT / CHECK / COLLATE / ENGINE 옵션 /
--        ON UPDATE CURRENT_TIMESTAMP / 인덱스 DESC.  치환: BOOLEAN -> TINYINT.
--  유지: 테이블, 컬럼, 타입, NULL 여부, DEFAULT, AUTO_INCREMENT, PK, UK, FK, 인덱스.
--
--  이 파일은 ERD 작도 전용이다. 실제 DB 생성에는 jellysafe_schema.sql 을 쓸 것.
-- =====================================================================================


CREATE TABLE users (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    role           VARCHAR(20)  NOT NULL DEFAULT 'public',
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    name           VARCHAR(100) NOT NULL,
    organization   VARCHAR(150) NULL,
    managed_region VARCHAR(50)  NULL,
    is_active      TINYINT      NOT NULL DEFAULT 1,
    last_login_at  DATETIME     NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uk_users_email UNIQUE (email)
);

CREATE TABLE beaches (
    id                  BIGINT        NOT NULL AUTO_INCREMENT,
    name                VARCHAR(100)  NOT NULL,
    region              VARCHAR(50)   NOT NULL,
    lat                 DECIMAL(10,7) NOT NULL,
    lng                 DECIMAL(10,7) NOT NULL,
    facing_direction    SMALLINT      NULL,
    priority            SMALLINT      NOT NULL DEFAULT 99,
    vulnerability_score SMALLINT      NOT NULL DEFAULT 0,
    is_active           TINYINT       NOT NULL DEFAULT 1,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_beaches PRIMARY KEY (id),
    CONSTRAINT uk_beaches_name UNIQUE (name)
);

CREATE TABLE static_guides (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    guide_code    VARCHAR(50)  NOT NULL,
    target_type   VARCHAR(20)  NOT NULL,
    risk_level    VARCHAR(20)  NULL,
    title         VARCHAR(200) NULL,
    body          TEXT         NOT NULL,
    display_order SMALLINT     NOT NULL DEFAULT 0,
    active        TINYINT      NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_static_guides PRIMARY KEY (id),
    CONSTRAINT uk_static_guides_code UNIQUE (guide_code)
);

CREATE TABLE risk_recommendations (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    action_code   VARCHAR(50)  NOT NULL,
    risk_level    VARCHAR(20)  NOT NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT         NULL,
    display_order SMALLINT     NOT NULL DEFAULT 0,
    active        TINYINT      NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_risk_recommendations PRIMARY KEY (id),
    CONSTRAINT uk_risk_recommendations_code UNIQUE (action_code)
);

CREATE TABLE data_sources (
    id                    BIGINT       NOT NULL AUTO_INCREMENT,
    source_code           VARCHAR(50)  NOT NULL,
    name                  VARCHAR(150) NOT NULL,
    provider              VARCHAR(100) NULL,
    source_type           VARCHAR(20)  NOT NULL,
    endpoint_url          VARCHAR(500) NULL,
    is_sample             TINYINT      NOT NULL DEFAULT 0,
    sync_interval_minutes INT          NULL,
    last_synced_at        DATETIME     NULL,
    last_sync_status      VARCHAR(20)  NULL,
    last_sync_message     VARCHAR(500) NULL,
    is_active             TINYINT      NOT NULL DEFAULT 1,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_data_sources PRIMARY KEY (id),
    CONSTRAINT uk_data_sources_code UNIQUE (source_code)
);

CREATE TABLE observation_stations (
    id           BIGINT        NOT NULL AUTO_INCREMENT,
    source_id    BIGINT        NOT NULL,
    station_code VARCHAR(50)   NOT NULL,
    name         VARCHAR(150)  NOT NULL,
    station_type VARCHAR(20)   NOT NULL,
    lat          DECIMAL(10,7) NOT NULL,
    lng          DECIMAL(10,7) NOT NULL,
    is_active    TINYINT       NOT NULL DEFAULT 1,
    created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_observation_stations PRIMARY KEY (id),
    CONSTRAINT uk_observation_stations_code UNIQUE (source_id, station_code),
    CONSTRAINT fk_observation_stations_source FOREIGN KEY (source_id) REFERENCES data_sources (id) ON DELETE RESTRICT
);

CREATE TABLE observations (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    station_id        BIGINT       NOT NULL,
    observed_at       DATETIME     NOT NULL,
    water_temp        DECIMAL(4,1) NULL,
    salinity          DECIMAL(5,2) NULL,
    wave_height       DECIMAL(4,2) NULL,
    current_direction SMALLINT     NULL,
    current_speed     DECIMAL(5,2) NULL,
    wind_direction    SMALLINT     NULL,
    wind_speed        DECIMAL(5,2) NULL,
    air_temp          DECIMAL(4,1) NULL,
    precipitation     DECIMAL(6,2) NULL,
    quality_flag      VARCHAR(20)  NOT NULL DEFAULT 'normal',
    collected_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_observations PRIMARY KEY (id),
    CONSTRAINT uk_observations_station_time UNIQUE (station_id, observed_at),
    CONSTRAINT fk_observations_station FOREIGN KEY (station_id) REFERENCES observation_stations (id) ON DELETE CASCADE
);

CREATE TABLE observation_mappings (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    beach_id     BIGINT       NOT NULL,
    station_id   BIGINT       NOT NULL,
    station_type VARCHAR(20)  NOT NULL,
    distance_km  DECIMAL(7,3) NULL,
    is_primary   TINYINT      NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_observation_mappings PRIMARY KEY (id),
    CONSTRAINT uk_observation_mappings_pair UNIQUE (beach_id, station_id),
    CONSTRAINT uk_observation_mappings_primary UNIQUE (beach_id, station_type, is_primary),
    CONSTRAINT fk_observation_mappings_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_observation_mappings_station FOREIGN KEY (station_id) REFERENCES observation_stations (id) ON DELETE CASCADE
);

CREATE TABLE jellyfish_occurrences (
    id            BIGINT        NOT NULL AUTO_INCREMENT,
    source_id     BIGINT        NOT NULL,
    external_id   VARCHAR(100)  NULL,
    occurred_at   DATETIME      NOT NULL,
    region        VARCHAR(50)   NULL,
    lat           DECIMAL(10,7) NULL,
    lng           DECIMAL(10,7) NULL,
    species       VARCHAR(100)  NULL,
    is_toxic      TINYINT       NULL,
    density_level VARCHAR(20)   NULL,
    alert_level   VARCHAR(20)   NULL,
    description   VARCHAR(500)  NULL,
    collected_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_jellyfish_occurrences PRIMARY KEY (id),
    CONSTRAINT uk_jellyfish_occurrences_ext UNIQUE (source_id, external_id),
    CONSTRAINT fk_jellyfish_occurrences_source FOREIGN KEY (source_id) REFERENCES data_sources (id) ON DELETE RESTRICT
);

CREATE TABLE consent_logs (
    id             BIGINT      NOT NULL AUTO_INCREMENT,
    user_id        BIGINT      NULL,
    user_token     VARCHAR(64) NULL,
    consent_type   VARCHAR(30) NOT NULL,
    agreed         TINYINT     NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    agreed_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address     VARCHAR(45) NULL,
    expires_at     DATETIME    NULL,
    CONSTRAINT pk_consent_logs PRIMARY KEY (id),
    CONSTRAINT fk_consent_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE jellyfish_reports (
    id                     BIGINT        NOT NULL AUTO_INCREMENT,
    beach_id               BIGINT        NULL,
    reporter_user_id       BIGINT        NULL,
    reporter_token         VARCHAR(64)   NULL,
    lat                    DECIMAL(10,7) NULL,
    lng                    DECIMAL(10,7) NULL,
    image_url              VARCHAR(500)  NOT NULL,
    thumbnail_url          VARCHAR(500)  NULL,
    report_type            VARCHAR(20)   NOT NULL,
    status                 VARCHAR(20)   NOT NULL DEFAULT 'received',
    ai_result              VARCHAR(20)   NULL,
    ai_confidence          DECIMAL(5,4)  NULL,
    duplicate_of_report_id BIGINT        NULL,
    occurred_at            DATETIME      NOT NULL,
    submitted_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reflected_at           DATETIME      NULL,
    purge_scheduled_at     DATETIME      NULL,
    CONSTRAINT pk_jellyfish_reports PRIMARY KEY (id),
    KEY ix_jellyfish_reports_beach_time (beach_id, submitted_at),
    CONSTRAINT fk_jellyfish_reports_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    CONSTRAINT fk_jellyfish_reports_user FOREIGN KEY (reporter_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_jellyfish_reports_duplicate FOREIGN KEY (duplicate_of_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL
);

CREATE TABLE report_consents (
    id             BIGINT   NOT NULL AUTO_INCREMENT,
    report_id      BIGINT   NOT NULL,
    consent_log_id BIGINT   NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_report_consents PRIMARY KEY (id),
    CONSTRAINT uk_report_consents_pair UNIQUE (report_id, consent_log_id),
    CONSTRAINT fk_report_consents_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE,
    CONSTRAINT fk_report_consents_consent FOREIGN KEY (consent_log_id) REFERENCES consent_logs (id) ON DELETE RESTRICT
);

CREATE TABLE vision_results (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    report_id      BIGINT       NOT NULL,
    model_name     VARCHAR(100) NOT NULL DEFAULT 'VISION_MOCK',
    model_version  VARCHAR(30)  NULL,
    result         VARCHAR(20)  NULL,
    confidence     DECIMAL(5,4) NULL,
    process_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
    error_message  VARCHAR(500) NULL,
    raw_response   JSON         NULL,
    is_latest      TINYINT      NULL,
    requested_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at   DATETIME     NULL,
    CONSTRAINT pk_vision_results PRIMARY KEY (id),
    CONSTRAINT uk_vision_results_latest UNIQUE (report_id, is_latest),
    CONSTRAINT fk_vision_results_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE
);

CREATE TABLE report_reviews (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    report_id      BIGINT       NOT NULL,
    review_status  VARCHAR(20)  NOT NULL,
    reject_reason  VARCHAR(30)  NULL,
    memo           VARCHAR(500) NULL,
    reflected_risk TINYINT      NOT NULL DEFAULT 0,
    reviewed_by    BIGINT       NOT NULL,
    reviewed_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_report_reviews PRIMARY KEY (id),
    KEY ix_report_reviews_report_time (report_id, reviewed_at),
    KEY ix_report_reviews_reviewer (reviewed_by, reviewed_at),
    CONSTRAINT fk_report_reviews_report FOREIGN KEY (report_id) REFERENCES jellyfish_reports (id) ON DELETE CASCADE,
    CONSTRAINT fk_report_reviews_user FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE risk_rule_configs (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    rule_code      VARCHAR(50)  NOT NULL,
    rule_category  VARCHAR(30)  NOT NULL,
    rule_name      VARCHAR(150) NOT NULL,
    score          SMALLINT     NULL,
    condition_json JSON         NULL,
    min_risk_level VARCHAR(20)  NULL,
    version        VARCHAR(20)  NOT NULL DEFAULT 'v1',
    active         TINYINT      NOT NULL DEFAULT 1,
    updated_by     BIGINT       NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_risk_rule_configs PRIMARY KEY (id),
    CONSTRAINT uk_risk_rule_configs_code_version UNIQUE (rule_code, version),
    CONSTRAINT fk_risk_rule_configs_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE risk_calculations (
    id                   BIGINT       NOT NULL AUTO_INCREMENT,
    calculation_uid      VARCHAR(50)  NOT NULL,
    trigger_type         VARCHAR(30)  NOT NULL,
    trigger_report_id    BIGINT       NULL,
    triggered_by         BIGINT       NULL,
    rule_version         VARCHAR(20)  NOT NULL,
    affected_beach_count INT          NOT NULL DEFAULT 0,
    calc_status          VARCHAR(20)  NOT NULL DEFAULT 'running',
    error_message        VARCHAR(500) NULL,
    started_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at          DATETIME     NULL,
    CONSTRAINT pk_risk_calculations PRIMARY KEY (id),
    CONSTRAINT uk_risk_calculations_uid UNIQUE (calculation_uid),
    CONSTRAINT fk_risk_calculations_report FOREIGN KEY (trigger_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL,
    CONSTRAINT fk_risk_calculations_user FOREIGN KEY (triggered_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE risk_scores (
    id                  BIGINT      NOT NULL AUTO_INCREMENT,
    calculation_id      BIGINT      NOT NULL,
    beach_id            BIGINT      NOT NULL,
    horizon             VARCHAR(10) NOT NULL,
    risk_score          SMALLINT    NOT NULL,
    risk_level          VARCHAR(20) NOT NULL,
    base_risk_level     VARCHAR(20) NULL,
    min_level_applied   TINYINT     NOT NULL DEFAULT 0,
    min_level_rule_code VARCHAR(50) NULL,
    data_confidence     VARCHAR(10) NOT NULL DEFAULT 'medium',
    rule_version        VARCHAR(20) NOT NULL,
    model_id            BIGINT      NULL,
    is_latest           TINYINT     NULL,
    generated_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_risk_scores PRIMARY KEY (id),
    CONSTRAINT uk_risk_scores_latest UNIQUE (beach_id, horizon, is_latest),
    KEY ix_risk_scores_calculation (calculation_id),
    CONSTRAINT fk_risk_scores_calculation FOREIGN KEY (calculation_id) REFERENCES risk_calculations (id) ON DELETE CASCADE,
    CONSTRAINT fk_risk_scores_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE
);

CREATE TABLE risk_factors (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    risk_score_id    BIGINT       NOT NULL,
    factor_code      VARCHAR(50)  NOT NULL,
    factor_name      VARCHAR(150) NOT NULL,
    factor_detail    VARCHAR(500) NULL,
    score_delta      SMALLINT     NOT NULL,
    source_report_id BIGINT       NULL,
    display_order    SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT pk_risk_factors PRIMARY KEY (id),
    KEY ix_risk_factors_score_order (risk_score_id, display_order),
    CONSTRAINT fk_risk_factors_score FOREIGN KEY (risk_score_id) REFERENCES risk_scores (id) ON DELETE CASCADE,
    CONSTRAINT fk_risk_factors_report FOREIGN KEY (source_report_id) REFERENCES jellyfish_reports (id) ON DELETE SET NULL
);

CREATE TABLE operation_actions (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    beach_id          BIGINT       NOT NULL,
    risk_score_id     BIGINT       NULL,
    recommendation_id BIGINT       NULL,
    action_type       VARCHAR(50)  NULL,
    operation_status  VARCHAR(30)  NOT NULL,
    memo              VARCHAR(500) NULL,
    created_by        BIGINT       NOT NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_operation_actions PRIMARY KEY (id),
    KEY ix_operation_actions_beach_time (beach_id, created_at),
    KEY ix_operation_actions_creator (created_by, created_at),
    CONSTRAINT fk_operation_actions_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    CONSTRAINT fk_operation_actions_score FOREIGN KEY (risk_score_id) REFERENCES risk_scores (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_actions_recommendation FOREIGN KEY (recommendation_id) REFERENCES risk_recommendations (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_actions_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE operation_status_logs (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    beach_id            BIGINT       NOT NULL,
    operation_action_id BIGINT       NULL,
    previous_status     VARCHAR(30)  NULL,
    new_status          VARCHAR(30)  NOT NULL,
    reason              VARCHAR(500) NULL,
    changed_by          BIGINT       NOT NULL,
    changed_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_operation_status_logs PRIMARY KEY (id),
    KEY ix_operation_status_logs_beach_time (beach_id, changed_at),
    CONSTRAINT fk_operation_status_logs_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE RESTRICT,
    CONSTRAINT fk_operation_status_logs_action FOREIGN KEY (operation_action_id) REFERENCES operation_actions (id) ON DELETE SET NULL,
    CONSTRAINT fk_operation_status_logs_user FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE notification_templates (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    template_code VARCHAR(50)  NOT NULL,
    target_type   VARCHAR(20)  NOT NULL,
    risk_level    VARCHAR(20)  NULL,
    event_type    VARCHAR(30)  NULL,
    title         VARCHAR(200) NULL,
    body          TEXT         NOT NULL,
    active        TINYINT      NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_notification_templates PRIMARY KEY (id),
    CONSTRAINT uk_notification_templates_code UNIQUE (template_code)
);

CREATE TABLE notifications (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    target_type       VARCHAR(20)  NOT NULL,
    target_user_id    BIGINT       NULL,
    target_user_token VARCHAR(64)  NULL,
    beach_id          BIGINT       NOT NULL,
    risk_level        VARCHAR(20)  NULL,
    event_type        VARCHAR(30)  NOT NULL,
    template_id       BIGINT       NULL,
    message           TEXT         NOT NULL,
    dedup_key         VARCHAR(150) NULL,
    cooldown_until    DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at           DATETIME     NULL,
    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT uk_notifications_dedup UNIQUE (dedup_key),
    KEY ix_notifications_user_read (target_user_id, read_at, created_at),
    KEY ix_notifications_beach_time (beach_id, created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_template FOREIGN KEY (template_id) REFERENCES notification_templates (id) ON DELETE SET NULL
);

CREATE TABLE daily_reports (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    beach_id            BIGINT       NOT NULL,
    report_date         DATE         NOT NULL,
    summary_json        JSON         NULL,
    max_risk_level      VARCHAR(20)  NULL,
    risk_change_summary VARCHAR(200) NULL,
    report_count        INT          NOT NULL DEFAULT 0,
    toxic_count         INT          NOT NULL DEFAULT 0,
    sting_count         INT          NOT NULL DEFAULT 0,
    action_count        INT          NOT NULL DEFAULT 0,
    memo                TEXT         NULL,
    created_by          BIGINT       NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_daily_reports PRIMARY KEY (id),
    CONSTRAINT uk_daily_reports_beach_date UNIQUE (beach_id, report_date),
    CONSTRAINT fk_daily_reports_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE,
    CONSTRAINT fk_daily_reports_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE favorite_beaches (
    id         BIGINT      NOT NULL AUTO_INCREMENT,
    user_id    BIGINT      NULL,
    user_token VARCHAR(64) NULL,
    beach_id   BIGINT      NOT NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_favorite_beaches PRIMARY KEY (id),
    CONSTRAINT uk_favorite_beaches_user UNIQUE (user_id, beach_id),
    CONSTRAINT uk_favorite_beaches_token UNIQUE (user_token, beach_id),
    CONSTRAINT fk_favorite_beaches_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_favorite_beaches_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    user_id     BIGINT      NULL,
    action_type VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id   BIGINT      NULL,
    before_json JSON        NULL,
    after_json  JSON        NULL,
    ip_address  VARCHAR(45) NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    KEY ix_audit_logs_user_time (user_id, created_at),
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE notification_consents (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    user_id      BIGINT       NULL,
    user_token   VARCHAR(64)  NULL,
    channel      VARCHAR(20)  NOT NULL,
    agreed       TINYINT      NOT NULL DEFAULT 0,
    phone_number VARCHAR(30)  NULL,
    device_token VARCHAR(255) NULL,
    agreed_at    DATETIME     NULL,
    revoked_at   DATETIME     NULL,
    CONSTRAINT pk_notification_consents PRIMARY KEY (id),
    CONSTRAINT fk_notification_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE notification_dispatches (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    notification_id BIGINT        NOT NULL,
    channel         VARCHAR(20)   NOT NULL,
    provider        VARCHAR(50)   NULL,
    recipient       VARCHAR(255)  NOT NULL,
    dispatch_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
    failed_reason   VARCHAR(500)  NULL,
    retry_count     SMALLINT      NOT NULL DEFAULT 0,
    cost_amount     DECIMAL(10,2) NULL,
    sent_at         DATETIME      NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_notification_dispatches PRIMARY KEY (id),
    CONSTRAINT fk_notification_dispatches_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
);

CREATE TABLE partners (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    partner_code   VARCHAR(50)  NOT NULL,
    name           VARCHAR(150) NOT NULL,
    business_no    VARCHAR(30)  NULL,
    contact_name   VARCHAR(100) NULL,
    contact_email  VARCHAR(255) NULL,
    plan_code      VARCHAR(30)  NULL,
    partner_status VARCHAR(20)  NOT NULL DEFAULT 'active',
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_partners PRIMARY KEY (id),
    CONSTRAINT uk_partners_code UNIQUE (partner_code)
);

CREATE TABLE partner_api_keys (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    partner_id         BIGINT       NOT NULL,
    key_prefix         VARCHAR(16)  NOT NULL,
    api_key_hash       VARCHAR(255) NOT NULL,
    scopes_json        JSON         NULL,
    rate_limit_per_min INT          NULL,
    expires_at         DATETIME     NULL,
    revoked_at         DATETIME     NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_partner_api_keys PRIMARY KEY (id),
    CONSTRAINT uk_partner_api_keys_prefix UNIQUE (key_prefix),
    CONSTRAINT fk_partner_api_keys_partner FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE
);

CREATE TABLE partner_api_call_logs (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    partner_id       BIGINT       NOT NULL,
    api_key_id       BIGINT       NULL,
    endpoint         VARCHAR(255) NOT NULL,
    http_method      VARCHAR(10)  NOT NULL,
    status_code      SMALLINT     NOT NULL,
    response_time_ms INT          NULL,
    is_billable      TINYINT      NOT NULL DEFAULT 1,
    called_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_partner_api_call_logs PRIMARY KEY (id),
    KEY ix_partner_api_call_logs_partner_time (partner_id, called_at),
    CONSTRAINT fk_partner_api_call_logs_partner FOREIGN KEY (partner_id) REFERENCES partners (id) ON DELETE CASCADE,
    CONSTRAINT fk_partner_api_call_logs_key FOREIGN KEY (api_key_id) REFERENCES partner_api_keys (id) ON DELETE SET NULL
);

CREATE TABLE ml_models (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    model_name       VARCHAR(100) NOT NULL,
    version          VARCHAR(30)  NOT NULL,
    algorithm        VARCHAR(50)  NULL,
    model_purpose    VARCHAR(30)  NOT NULL,
    hyperparams_json JSON         NULL,
    metrics_json     JSON         NULL,
    artifact_uri     VARCHAR(500) NULL,
    model_status     VARCHAR(20)  NOT NULL DEFAULT 'training',
    trained_at       DATETIME     NULL,
    activated_at     DATETIME     NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_ml_models PRIMARY KEY (id),
    CONSTRAINT uk_ml_models_name_version UNIQUE (model_name, version)
);

CREATE TABLE subscriptions (
    id                  BIGINT        NOT NULL AUTO_INCREMENT,
    user_id             BIGINT        NOT NULL,
    subscriber_type     VARCHAR(20)   NOT NULL,
    plan_code           VARCHAR(30)   NOT NULL,
    subscription_status VARCHAR(20)   NOT NULL DEFAULT 'pending',
    price_amount        DECIMAL(10,2) NULL,
    payment_status      VARCHAR(20)   NULL,
    started_at          DATETIME      NULL,
    expires_at          DATETIME      NULL,
    created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_subscriptions PRIMARY KEY (id),
    KEY ix_subscriptions_user_status (user_id, subscription_status),
    CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE subscription_areas (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    subscription_id BIGINT        NOT NULL,
    beach_id        BIGINT        NULL,
    label           VARCHAR(100)  NULL,
    center_lat      DECIMAL(10,7) NULL,
    center_lng      DECIMAL(10,7) NULL,
    radius_km       DECIMAL(6,2)  NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_subscription_areas PRIMARY KEY (id),
    CONSTRAINT fk_subscription_areas_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id) ON DELETE CASCADE,
    CONSTRAINT fk_subscription_areas_beach FOREIGN KEY (beach_id) REFERENCES beaches (id) ON DELETE CASCADE
);

ALTER TABLE risk_scores
    ADD CONSTRAINT fk_risk_scores_model FOREIGN KEY (model_id) REFERENCES ml_models (id) ON DELETE SET NULL;
CREATE INDEX ix_risk_scores_level ON risk_scores (risk_level, generated_at);
CREATE INDEX ix_jellyfish_reports_status_time ON jellyfish_reports (status, submitted_at);
CREATE INDEX ix_jellyfish_reports_ai_result   ON jellyfish_reports (ai_result, submitted_at);
CREATE INDEX ix_jellyfish_reports_dup_window  ON jellyfish_reports (beach_id, occurred_at, report_type);
CREATE INDEX ix_jellyfish_reports_reporter    ON jellyfish_reports (reporter_token, submitted_at);
CREATE INDEX ix_vision_results_status ON vision_results (process_status, requested_at);
CREATE INDEX ix_jellyfish_occurrences_time_region ON jellyfish_occurrences (occurred_at, region);
CREATE INDEX ix_jellyfish_occurrences_geo         ON jellyfish_occurrences (lat, lng);
CREATE INDEX ix_notifications_token_read ON notifications (target_user_token, read_at, created_at);
CREATE INDEX ix_daily_reports_date ON daily_reports (report_date);
CREATE INDEX ix_audit_logs_target ON audit_logs (target_type, target_id, created_at);
CREATE INDEX ix_consent_logs_token ON consent_logs (user_token, agreed_at);
CREATE INDEX ix_risk_rule_configs_active ON risk_rule_configs (active, rule_category);
CREATE INDEX ix_risk_calculations_time ON risk_calculations (started_at);
CREATE INDEX ix_notification_dispatches_status ON notification_dispatches (dispatch_status, created_at);
