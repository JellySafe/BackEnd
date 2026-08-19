import { Module } from '@nestjs/common';
import { RISK_RECALC } from '@contexts/report/application/port/out/risk-recalc.port';
import { RISK_RECALC_TRIGGER } from '@contexts/observation/application/port/out/risk-recalc-trigger.port';
import { NotificationModule } from '@contexts/notification/notification.module';
import { SystemRiskController } from './adapter/in/web/system-risk.controller';
import { AdminRiskController } from './adapter/in/web/admin-risk.controller';
import { PublicRiskController } from './adapter/in/web/public-risk.controller';
import { CalculateRiskService } from './application/service/calculate-risk.service';
import { GetBeachRiskDetailService } from './application/service/get-beach-risk-detail.service';
import { ListLatestRisksService } from './application/service/list-latest-risks.service';
import { GetDashboardSummaryService } from './application/service/get-dashboard-summary.service';
import { ListRiskRulesService } from './application/service/list-risk-rules.service';
import { RiskRecalcAdapter } from './adapter/out/risk-recalc.adapter';
import { ObservationRecalcAdapter } from './adapter/out/observation-recalc.adapter';
import { RuleConfigKyselyQuery } from './adapter/out/persistence/rule-config.kysely-query';
import { RiskInputKyselyQuery } from './adapter/out/persistence/risk-input.kysely-query';
import { RiskPrismaRepository } from './adapter/out/persistence/risk.prisma-repository';
import { RiskKyselyQuery } from './adapter/out/persistence/risk.kysely-query';
import { RiskAlertAdapter } from './adapter/out/risk-alert.adapter';
import { RiskRecalcScheduler } from './adapter/in/schedule/risk-recalc.scheduler';
import { RiskHistoryPurgeScheduler } from './adapter/in/schedule/risk-history-purge.scheduler';
import { StaleCalculationRecovery } from './adapter/in/lifecycle/stale-calculation-recovery';
import { RiskHistoryPurgePrismaRepository } from './adapter/out/persistence/risk-history-purge.prisma-repository';
import { RISK_HISTORY_PURGE } from './application/port/out/risk-history-purge.port';
import { RULE_CONFIG } from './application/port/out/rule-config.port';
import { RISK_INPUT } from './application/port/out/risk-input.port';
import { RISK_PERSISTENCE } from './application/port/out/risk-persistence.port';
import { RISK_QUERY } from './application/port/out/risk-query.port';
import { RISK_ALERT } from './application/port/out/risk-alert.port';
import {
  CALCULATE_RISK_USE_CASE,
  GET_BEACH_RISK_DETAIL_USE_CASE,
  GET_DASHBOARD_SUMMARY_USE_CASE,
  LIST_LATEST_RISKS_USE_CASE,
  LIST_RISK_RULES_USE_CASE,
} from './application/port/in/risk-use-cases';

/**
 * risk 컨텍스트 (위험도 룰 엔진 SYS-003).
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(룰/입력/영속성/조회)를 DI 토큰으로 어댑터에 바인딩한다.
 *
 * exports:
 *  - RISK_RECALC: report 의 RiskRecalcPort 구현. app 조립 시 report 의 noop 대신 이 어댑터가 연결된다.
 *  - RISK_RECALC_TRIGGER: observation 배치가 수집·매핑 후 위험도 재산출(data_sync)을 트리거하는 포트 구현.
 *  - CALCULATE_RISK_USE_CASE: 스케줄러/배치가 위험도 산출을 직접 호출할 수 있게 노출한다.
 */
@Module({
  imports: [NotificationModule],
  controllers: [SystemRiskController, AdminRiskController, PublicRiskController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: CALCULATE_RISK_USE_CASE, useClass: CalculateRiskService },
    { provide: GET_BEACH_RISK_DETAIL_USE_CASE, useClass: GetBeachRiskDetailService },
    { provide: LIST_LATEST_RISKS_USE_CASE, useClass: ListLatestRisksService },
    { provide: GET_DASHBOARD_SUMMARY_USE_CASE, useClass: GetDashboardSummaryService },
    { provide: LIST_RISK_RULES_USE_CASE, useClass: ListRiskRulesService },
    // 아웃바운드 포트 → 어댑터
    { provide: RULE_CONFIG, useClass: RuleConfigKyselyQuery },
    { provide: RISK_INPUT, useClass: RiskInputKyselyQuery },
    { provide: RISK_PERSISTENCE, useClass: RiskPrismaRepository },
    { provide: RISK_QUERY, useClass: RiskKyselyQuery },
    // 산출 이력 파기 (30분마다 쌓이는 risk_scores/risk_factors 를 보관 기간 지나면 정리)
    { provide: RISK_HISTORY_PURGE, useClass: RiskHistoryPurgePrismaRepository },
    // report 의 재산출 포트 구현 (RECALC_BATCH 트리거)
    { provide: RISK_RECALC, useClass: RiskRecalcAdapter },
    // observation 배치의 재산출 트리거 포트 구현 (data_sync 트리거)
    { provide: RISK_RECALC_TRIGGER, useClass: ObservationRecalcAdapter },
    // 위험 단계 상승 알림 (SYS-005, level_up) → notification 컨텍스트로 위임
    { provide: RISK_ALERT, useClass: RiskAlertAdapter },
    // 주기적 위험도 재산출 스케줄러 (RISK_RECALC_CRON, triggerType='schedule')
    RiskRecalcScheduler,
    RiskHistoryPurgeScheduler,
    // 부팅 시 종료 기록 없이 남은 running 산출을 실패로 확정한다(비정상 종료 잔재 정리).
    StaleCalculationRecovery,
  ],
  exports: [RISK_RECALC, RISK_RECALC_TRIGGER, CALCULATE_RISK_USE_CASE],
})
export class RiskModule {}
