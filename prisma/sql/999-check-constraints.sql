-- =====================================================================================
--  값 계약 CHECK 제약
--
-- 이 파일은 prisma/value-contracts.ts 에서 생성된다. 손으로 고치지 않는다.
--     원본: prisma/value-contracts.ts (도메인 enum 배열을 그대로 엮은 표)
--     생성: npm run sql:check-constraints
--     검증: prisma/value-contracts.spec.ts 가 이 파일과 표가 일치하는지 본다.
--
--  왜 필요한가:
--    스키마 원본(../db/jellysafe_schema.sql)은 저장소 밖이라 CI 는 `prisma db push` 로
--    테이블을 만든다. 그 경로에는 CHECK 제약이 없어서, DB 제약에 막혀 저장이 안 되는
--    종류의 결함(#22)이 CI 에서 잡히지 않는다. 이 파일이 그 구멍을 메운다.
--
--  적용:
--    mysql -h <host> -u <user> -p <db> < prisma/sql/999-check-constraints.sql
--
--  파일 이름이 999 인 이유: 제약은 **테이블이 다 만들어진 뒤** 걸려야 한다. 준비 스크립트가
--  prisma/sql/*.sql 을 이름 순으로 적용하므로, 새 테이블 DDL(004 등)보다 뒤에 오도록 번호를
--  크게 잡아 둔다. 앞 번호를 쓰면 나중에 테이블이 추가될 때 조용히 순서가 어긋난다.
--
--  이미 제약이 있는 DB(스키마 원본으로 만든 로컬/운영)에서는 "Duplicate check constraint"
--  로 실패한다. 그건 이미 그 상태라는 뜻이므로 무시해도 된다.
--
--  NULL 은 따로 허용하지 않는다 — `NULL IN (...)` 은 UNKNOWN 이고 CHECK 는 거짓일 때만
--  막으므로, nullable 컬럼은 자동으로 NULL 을 통과시킨다.
-- =====================================================================================

-- users.role — 역할이 곧 인가 판정의 입력이다. 목록에 없는 값은 어느 가드도 통과시키지 않아야 한다.
ALTER TABLE users
  ADD CONSTRAINT ck_users_role CHECK (role IN ('public', 'operator', 'admin'));

-- static_guides.target_type — 안내 문구 노출 대상.
ALTER TABLE static_guides
  ADD CONSTRAINT ck_static_guides_target_type CHECK (target_type IN ('public', 'operator', 'admin', 'common'));

-- static_guides.risk_level — 단계별 안내 문구.
ALTER TABLE static_guides
  ADD CONSTRAINT ck_static_guides_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- risk_recommendations.risk_level — 단계별 운영 권고.
ALTER TABLE risk_recommendations
  ADD CONSTRAINT ck_risk_recommendations_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- jellyfish_species.toxicity — 국립수산과학원 등급 체계. 미공표 종은 NULL — 추정해서 채우지 않는다.
ALTER TABLE jellyfish_species
  ADD CONSTRAINT ck_jellyfish_species_toxicity CHECK (toxicity IN ('strong', 'mild', 'harmless'));

-- data_sources.source_type — 수집 대상 구분.
ALTER TABLE data_sources
  ADD CONSTRAINT ck_data_sources_source_type CHECK (source_type IN ('jellyfish', 'marine', 'weather', 'beach'));

-- data_sources.last_sync_status — 마지막 수집 결과. 운영자가 배치 상태를 읽는 값이다.
ALTER TABLE data_sources
  ADD CONSTRAINT ck_data_sources_last_sync_status CHECK (last_sync_status IN ('success', 'partial', 'failed'));

-- observation_stations.station_type — 관측소 종류.
ALTER TABLE observation_stations
  ADD CONSTRAINT ck_observation_stations_station_type CHECK (station_type IN ('marine', 'weather'));

-- observations.quality_flag — 결측·이상치 표시. 위험도 산출이 이 값으로 관측치를 걸러낸다.
ALTER TABLE observations
  ADD CONSTRAINT ck_observations_quality_flag CHECK (quality_flag IN ('normal', 'missing', 'outlier'));

-- observation_mappings.station_type — 해변↔관측소 매핑 종류.
ALTER TABLE observation_mappings
  ADD CONSTRAINT ck_observation_mappings_station_type CHECK (station_type IN ('marine', 'weather'));

-- jellyfish_occurrences.density_level — v3 위험도의 축. 이 값이 어긋나면 인근 출현 점수가 통째로 빗나간다.
ALTER TABLE jellyfish_occurrences
  ADD CONSTRAINT ck_jellyfish_occurrences_density_level CHECK (density_level IN ('low', 'medium', 'high'));

-- jellyfish_occurrences.alert_level — NIFS 주의보 단계.
ALTER TABLE jellyfish_occurrences
  ADD CONSTRAINT ck_jellyfish_occurrences_alert_level CHECK (alert_level IN ('none', 'attention', 'caution', 'warning'));

-- consent_logs.consent_type — 개인정보 동의 종류(PRIV-001).
ALTER TABLE consent_logs
  ADD CONSTRAINT ck_consent_logs_consent_type CHECK (consent_type IN ('privacy', 'location', 'image', 'marketing'));

-- jellyfish_reports.report_type — 제보 유형. 위험도 가중치가 여기서 갈린다.
ALTER TABLE jellyfish_reports
  ADD CONSTRAINT ck_jellyfish_reports_report_type CHECK (report_type IN ('general', 'multiple', 'sting'));

-- jellyfish_reports.status — 제보 상태 전이. 목록 밖 값은 검수 화면에서 어느 칸에도 잡히지 않는다.
ALTER TABLE jellyfish_reports
  ADD CONSTRAINT ck_jellyfish_reports_status CHECK (status IN ('received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'));

-- jellyfish_reports.ai_result — AI 판별 결과.
ALTER TABLE jellyfish_reports
  ADD CONSTRAINT ck_jellyfish_reports_ai_result CHECK (ai_result IN ('normal', 'toxic_suspected', 'unknown'));

-- vision_results.process_status — AI 판별 처리 상태.
ALTER TABLE vision_results
  ADD CONSTRAINT ck_vision_results_process_status CHECK (process_status IN ('pending', 'processing', 'done', 'failed'));

-- report_reviews.review_status — 검수 결과.
ALTER TABLE report_reviews
  ADD CONSTRAINT ck_report_reviews_review_status CHECK (review_status IN ('verified', 'rejected', 'hold'));

-- report_reviews.reject_reason — 반려 사유.
ALTER TABLE report_reviews
  ADD CONSTRAINT ck_report_reviews_reject_reason CHECK (reject_reason IN ('not_jellyfish', 'unclear', 'duplicate', 'wrong_location', 'inappropriate'));

-- risk_rule_configs.rule_category — 룰 종류.
ALTER TABLE risk_rule_configs
  ADD CONSTRAINT ck_risk_rule_configs_rule_category CHECK (rule_category IN ('risk_variable', 'report_weight', 'level_threshold', 'min_level'));

-- risk_rule_configs.min_risk_level — 최소 단계 보장(RISK-002)이 끌어올릴 단계.
ALTER TABLE risk_rule_configs
  ADD CONSTRAINT ck_risk_rule_configs_min_risk_level CHECK (min_risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- risk_calculations.trigger_type — 산출을 부른 입구.
ALTER TABLE risk_calculations
  ADD CONSTRAINT ck_risk_calculations_trigger_type CHECK (trigger_type IN ('schedule', 'data_sync', 'report_verified', 'manual'));

-- risk_calculations.calc_status — 산출 배치 상태. 부팅 시 고아 정리가 이 값을 본다.
ALTER TABLE risk_calculations
  ADD CONSTRAINT ck_risk_calculations_calc_status CHECK (calc_status IN ('running', 'success', 'partial', 'failed'));

-- risk_scores.horizon — 예측 지평. 오타가 들어가면 그 행은 어느 조회에도 잡히지 않고 조용히 쌓인다.
ALTER TABLE risk_scores
  ADD CONSTRAINT ck_risk_scores_horizon CHECK (horizon IN ('now', '6h', '24h', '72h'));

-- risk_scores.risk_level — 시민에게 보여주는 위험 단계. 이 컬럼이 이 서비스의 결론이다.
ALTER TABLE risk_scores
  ADD CONSTRAINT ck_risk_scores_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- risk_scores.base_risk_level — 최소 단계 보장 적용 전 단계.
ALTER TABLE risk_scores
  ADD CONSTRAINT ck_risk_scores_base_risk_level CHECK (base_risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- risk_scores.data_confidence — 데이터 신뢰도(RISK-005).
ALTER TABLE risk_scores
  ADD CONSTRAINT ck_risk_scores_data_confidence CHECK (data_confidence IN ('high', 'medium', 'low'));

-- operation_actions.operation_status — 운영 대응 상태(ADM-007).
ALTER TABLE operation_actions
  ADD CONSTRAINT ck_operation_actions_operation_status CHECK (operation_status IN ('normal', 'monitoring_up', 'entry_caution', 'lifeguard_added', 'broadcast', 'zone_control_review', 'entry_ban', 'resumed'));

-- operation_status_logs.previous_status — 운영 상태 변경 이력(이전).
ALTER TABLE operation_status_logs
  ADD CONSTRAINT ck_operation_status_logs_previous_status CHECK (previous_status IN ('normal', 'monitoring_up', 'entry_caution', 'lifeguard_added', 'broadcast', 'zone_control_review', 'entry_ban', 'resumed'));

-- operation_status_logs.new_status — 운영 상태 변경 이력(이후).
ALTER TABLE operation_status_logs
  ADD CONSTRAINT ck_operation_status_logs_new_status CHECK (new_status IN ('normal', 'monitoring_up', 'entry_caution', 'lifeguard_added', 'broadcast', 'zone_control_review', 'entry_ban', 'resumed'));

-- notification_templates.target_type — 문구 대상.
ALTER TABLE notification_templates
  ADD CONSTRAINT ck_notification_templates_target_type CHECK (target_type IN ('admin', 'operator', 'public'));

-- notification_templates.risk_level — 단계별 문구.
ALTER TABLE notification_templates
  ADD CONSTRAINT ck_notification_templates_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- notification_templates.event_type — 문구를 고르는 사건 종류.
ALTER TABLE notification_templates
  ADD CONSTRAINT ck_notification_templates_event_type CHECK (event_type IN ('level_up', 'toxic_report', 'sting_report'));

-- notifications.target_type — 알림 수신 대상.
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_target_type CHECK (target_type IN ('admin', 'operator', 'public'));

-- notifications.risk_level — 알림이 알리는 단계.
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_risk_level CHECK (risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- notifications.event_type — 알림을 만든 사건.
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_event_type CHECK (event_type IN ('level_up', 'toxic_report', 'sting_report'));

-- notification_consents.channel — 수신 동의 채널.
ALTER TABLE notification_consents
  ADD CONSTRAINT ck_notification_consents_channel CHECK (channel IN ('push', 'sms', 'kakao', 'email'));

-- notification_dispatches.channel — 실제 발송 채널.
ALTER TABLE notification_dispatches
  ADD CONSTRAINT ck_notification_dispatches_channel CHECK (channel IN ('push', 'sms', 'kakao', 'email'));

-- notification_dispatches.dispatch_status — 발송 결과. 문자 과금 집계가 이 값을 센다.
ALTER TABLE notification_dispatches
  ADD CONSTRAINT ck_notification_dispatches_dispatch_status CHECK (dispatch_status IN ('pending', 'sent', 'failed', 'rejected'));

-- daily_reports.max_risk_level — 그날의 최고 위험 단계.
ALTER TABLE daily_reports
  ADD CONSTRAINT ck_daily_reports_max_risk_level CHECK (max_risk_level IN ('safe', 'caution', 'danger', 'severe'));

-- field_observations.source — 누가 봤는가. 시민 제보와 달리 부재까지 기록하는 입력원이다.
ALTER TABLE field_observations
  ADD CONSTRAINT ck_field_observations_source CHECK (source IN ('lifeguard', 'official', 'partner'));

-- field_observations.density_level — 관측 밀도. 출현했으면 필수, 아니면 NULL(애플리케이션 불변식).
ALTER TABLE field_observations
  ADD CONSTRAINT ck_field_observations_density_level CHECK (density_level IN ('low', 'medium', 'high'));

-- sting_incidents.source — 사고를 알려온 경로. 중복 유입을 가려내는 데 쓴다.
ALTER TABLE sting_incidents
  ADD CONSTRAINT ck_sting_incidents_source CHECK (source IN ('emergency_call', 'coast_guard', 'lifeguard', 'hospital', 'self_report'));

-- sting_incidents.severity — 피해 정도. 의학적 중증도가 아니라 운영 판단에 필요한 최소 구분이다.
ALTER TABLE sting_incidents
  ADD CONSTRAINT ck_sting_incidents_severity CHECK (severity IN ('mild', 'moderate', 'severe', 'fatal'));

-- prediction_evaluations.predicted_level — 그날 그 해변 예측 중 최고 단계.
ALTER TABLE prediction_evaluations
  ADD CONSTRAINT ck_prediction_evaluations_predicted_level CHECK (predicted_level IN ('safe', 'caution', 'danger', 'severe'));

-- prediction_evaluations.actual_density — 실제 관측된 최고 밀도.
ALTER TABLE prediction_evaluations
  ADD CONSTRAINT ck_prediction_evaluations_actual_density CHECK (actual_density IN ('low', 'medium', 'high'));

-- prediction_evaluations.outcome — 혼동 행렬의 네 칸. 이 값이 어긋나면 정확도 지표가 통째로 거짓말을 한다.
ALTER TABLE prediction_evaluations
  ADD CONSTRAINT ck_prediction_evaluations_outcome CHECK (outcome IN ('hit', 'miss', 'false_alarm', 'correct_negative'));

-- prediction_evaluations.alert_threshold — 판정에 쓴 경보 임계선. 정책이 바뀌어도 과거 판정을 해석할 수 있어야 한다.
ALTER TABLE prediction_evaluations
  ADD CONSTRAINT ck_prediction_evaluations_alert_threshold CHECK (alert_threshold IN ('safe', 'caution', 'danger', 'severe'));

-- partners.partner_status — 제휴사 상태. 정지된 제휴사의 키는 통하지 않아야 한다.
ALTER TABLE partners
  ADD CONSTRAINT ck_partners_partner_status CHECK (partner_status IN ('active', 'suspended', 'terminated'));

-- ml_models.model_status — 모델 생애 상태. 한 용도에 active 는 하나다.
ALTER TABLE ml_models
  ADD CONSTRAINT ck_ml_models_model_status CHECK (model_status IN ('training', 'staging', 'active', 'archived'));

-- subscriptions.subscriber_type — 구독자 구분(어민/양식장).
ALTER TABLE subscriptions
  ADD CONSTRAINT ck_subscriptions_subscriber_type CHECK (subscriber_type IN ('fisherman', 'aquafarm'));

-- subscriptions.subscription_status — 활성 구독만 해역 알림을 받는다.
ALTER TABLE subscriptions
  ADD CONSTRAINT ck_subscriptions_subscription_status CHECK (subscription_status IN ('pending', 'active', 'paused', 'canceled', 'expired'));

-- subscriptions.payment_status — 결제 상태.
ALTER TABLE subscriptions
  ADD CONSTRAINT ck_subscriptions_payment_status CHECK (payment_status IN ('unpaid', 'paid', 'refunded'));
