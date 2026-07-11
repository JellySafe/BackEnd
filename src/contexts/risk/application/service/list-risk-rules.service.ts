import { Inject, Injectable } from '@nestjs/common';
import { ListRiskRulesUseCase, RiskRuleView } from '../port/in/risk-use-cases';
import { RuleConfigPort, RULE_CONFIG } from '../port/out/rule-config.port';

/**
 * ADM-012 위험도 룰 기준 조회 (조회 전용).
 * 현재 활성 버전(env RISK_RULE_VERSION, 기본 v1)의 활성 룰을 반환한다.
 */
@Injectable()
export class ListRiskRulesService implements ListRiskRulesUseCase {
  constructor(@Inject(RULE_CONFIG) private readonly ruleConfig: RuleConfigPort) {}

  async list(): Promise<RiskRuleView[]> {
    const version = process.env.RISK_RULE_VERSION || 'v1';
    const rows = await this.ruleConfig.loadActive(version);
    return rows.map((r) => ({
      ruleCode: r.ruleCode,
      ruleCategory: r.ruleCategory,
      ruleName: r.ruleName,
      score: r.score,
      minRiskLevel: r.minRiskLevel,
      version: r.version,
      active: r.active,
    }));
  }
}
