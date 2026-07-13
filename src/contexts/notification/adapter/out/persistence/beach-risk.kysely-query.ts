import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { RiskLevel, isRiskLevel } from '@shared/kernel/risk-level';
import { BeachRiskQueryPort } from '../../../application/port/out/beach-risk-query.port';

/**
 * 해변 현재 위험단계 조회 어댑터 (Kysely). 알림 문구 {riskLevel} 자동 채움용 읽기 모델.
 * risk_scores 의 현재 시점(horizon='now') 최신 행(is_latest=1) 한 건만 읽는다.
 * 동일 조건 행이 여러 개일 가능성에 대비해 최신 생성분을 우선한다.
 */
@Injectable()
export class BeachRiskKyselyQuery implements BeachRiskQueryPort {
  constructor(private readonly db: KyselyService) {}

  async findCurrentRiskLevel(beachId: Id): Promise<RiskLevel | null> {
    const row = await this.db
      .selectFrom('risk_scores as r')
      .select('r.risk_level as riskLevel')
      .where('r.beach_id', '=', beachId)
      .where('r.horizon', '=', 'now')
      .where('r.is_latest', '=', 1)
      .orderBy('r.generated_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    // DB 는 문자열 컬럼이므로 공용 커널의 타입 가드로 좁힌다(계약 외 값은 null 취급).
    const level = row?.riskLevel;
    return isRiskLevel(level) ? level : null;
  }
}
