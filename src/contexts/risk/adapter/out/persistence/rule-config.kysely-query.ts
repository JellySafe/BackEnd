import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RuleCategory } from '../../../domain/risk-enums';
import { RuleConfigPort, RuleConfigRow } from '../../../application/port/out/rule-config.port';

/**
 * 위험도 룰 설정 조회 어댑터 (Kysely).
 * 활성 버전의 룰을 로드한다(엔진 점수 SYS-003 + 룰 목록 ADM-012 공용).
 */
@Injectable()
export class RuleConfigKyselyQuery implements RuleConfigPort {
  constructor(private readonly db: KyselyService) {}

  async loadActive(version: string): Promise<RuleConfigRow[]> {
    const rows = await this.db
      .selectFrom('risk_rule_configs as c')
      .select([
        'c.rule_code as ruleCode',
        'c.rule_category as ruleCategory',
        'c.rule_name as ruleName',
        'c.score as score',
        'c.min_risk_level as minRiskLevel',
        'c.version as version',
        'c.active as active',
      ])
      .where('c.version', '=', version)
      .where('c.active', '=', 1)
      .orderBy('c.rule_category', 'asc')
      .orderBy('c.rule_code', 'asc')
      .execute();

    return rows.map((row) => ({
      ruleCode: row.ruleCode,
      ruleCategory: row.ruleCategory as RuleCategory,
      ruleName: row.ruleName,
      score: row.score === null ? null : Number(row.score),
      minRiskLevel: row.minRiskLevel ?? null,
      version: row.version,
      active: Number(row.active) === 1,
    }));
  }
}
