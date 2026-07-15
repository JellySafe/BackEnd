import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { RiskHistoryPurgePort } from '../../../application/port/out/risk-history-purge.port';

/**
 * 위험도 산출 이력 파기 어댑터 (RiskHistoryPurgePort 구현).
 *
 * risk_calculations 만 지우면 된다. risk_scores(fk_risk_scores_calculation)와
 * risk_factors(fk_risk_factors_score)가 ON DELETE CASCADE 로 걸려 있어
 * 점수·요인은 함께 정리된다.
 *
 * 한 번에 다 지우지 않고 batchSize 씩 끊어 지운다. 산출 1건이 점수 36행 +
 * 요인 100여 행을 끌고 오므로, 수천 건을 한 문장으로 지우면 CASCADE 삭제가
 * 수십만 행에 달해 잠금이 길어지고 다른 요청이 밀린다.
 */
@Injectable()
export class RiskHistoryPurgePrismaRepository implements RiskHistoryPurgePort {
  private readonly logger = new Logger(RiskHistoryPurgePrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    let total = 0;

    for (;;) {
      // 현재 값(is_latest)이 매달린 산출은 제외한다. 오래 재산출되지 않은 해변의
      // 현재 위험도까지 CASCADE 로 날아가면 화면에 표시할 값이 사라진다.
      //
      // 다중 테이블 DELETE(`DELETE c FROM ... c`)가 아니라 단일 테이블 DELETE 를 쓴다.
      // MySQL 은 다중 테이블 DELETE 에서 ORDER BY / LIMIT 을 허용하지 않는다(문법 오류).
      // 배치로 끊어 지우려면 단일 테이블 형태여야 한다.
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM risk_calculations
        WHERE started_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM risk_scores s
            WHERE s.calculation_id = risk_calculations.id AND s.is_latest = 1
          )
        ORDER BY id
        LIMIT ${batchSize}
      `;

      total += deleted;
      if (deleted < batchSize) {
        break;
      }
      this.logger.debug(`위험도 이력 파기 진행 중: 누적 ${total}건`);
    }

    return total;
  }
}
