import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { ObservationPurgePort } from '../../../application/port/out/observation-purge.port';

/**
 * 관측 시계열 파기 어댑터 (ObservationPurgePort 구현).
 *
 * observations 를 참조하는 FK 는 없다(observations → observation_stations 단방향).
 * 따라서 이 행들을 지워도 끌려 나가는 자식 행이 없다. 반대로 관측소를 지우면
 * fk_observations_station ON DELETE CASCADE 로 관측이 함께 지워지지만, 여기서는
 * 관측소를 건드리지 않는다.
 *
 * ── 지우면 안 되는 행 ──────────────────────────────────────────────────────────────
 * 관측소별 최신 1건은 보존한다. 위험도 산출(risk-input.kysely-query#findLatestObservation)
 * 이 **시간 필터 없이** 관측소별 최신 관측 1건을 읽기 때문이다. 오래 끊긴 관측소의 마지막
 * 관측까지 지우면 그 해변의 최신 관측이 사라져 수온/파고/해류가 한꺼번에 결측 처리되고
 * 신뢰도가 low 로 떨어진다. (risk-history-purge 가 is_latest 산출을 남기는 것과 같은 이유)
 */
@Injectable()
export class ObservationPurgePrismaRepository implements ObservationPurgePort {
  private readonly logger = new Logger(ObservationPurgePrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    let total = 0;

    for (;;) {
      // 단일 테이블 DELETE 를 쓴다. MySQL 은 다중 테이블 DELETE(`DELETE o FROM observations o …`)
      // 에서 ORDER BY / LIMIT 을 허용하지 않는다(문법 오류). 배치로 끊어 지우려면 이 형태여야 한다.
      //
      // 보존 대상(관측소별 최신 1건)을 파생 테이블(`AS keep`)로 감싼 이유:
      // MySQL 은 DELETE 대상 테이블을 서브쿼리에서 직접 참조하면 ERROR 1093 을 낸다.
      // 파생 테이블로 한 번 감싸면 먼저 구체화(materialize)되어 참조가 허용된다.
      // uk(station_id, observed_at) 덕분에 관측소당 정확히 1행이 뽑힌다.
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM observations
        WHERE observed_at < ${cutoff}
          AND id NOT IN (
            SELECT keep_id FROM (
              SELECT o2.id AS keep_id
              FROM observations o2
              INNER JOIN (
                SELECT station_id, MAX(observed_at) AS mx
                FROM observations
                GROUP BY station_id
              ) latest
                ON latest.station_id = o2.station_id AND latest.mx = o2.observed_at
            ) AS keep
          )
        ORDER BY id
        LIMIT ${batchSize}
      `;

      total += deleted;
      if (deleted < batchSize) {
        break;
      }
      this.logger.debug(`관측 파기 진행 중: 누적 ${total}행`);
    }

    return total;
  }
}
