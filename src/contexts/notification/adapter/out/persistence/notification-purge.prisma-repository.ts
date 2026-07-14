import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { NotificationPurgePort } from '../../../application/port/out/notification-purge.port';

/**
 * 알림 파기 어댑터 (NotificationPurgePort 구현).
 *
 * ── 발송 이력을 직접 지운다 (FK CASCADE 에 의존하지 않는다) ────────────────────────
 * db/jellysafe_schema.sql 과 prisma/schema.prisma 는 fk_notification_dispatches_notification
 * 을 ON DELETE CASCADE 로 선언하지만, **운영 DB(Aiven)에는 이 FK 가 실제로 없다.**
 * (information_schema 확인 결과 notification_dispatches 에 FK 제약이 0건)
 *
 * 지금까지는 문제가 되지 않았다 — notification_dispatches 에 쓰는 코드가 없어 늘 0행이었다.
 * 실제 Web Push 발송이 붙으면서 이 테이블에 행이 쌓이기 시작하므로, CASCADE 를 믿고
 * 부모만 지우면 **발송 이력이 고아로 남아 영원히 정리되지 않는다.**
 *
 * 그래서 자식(발송 이력) → 부모(알림) 순으로 명시적으로 지운다.
 * FK 가 있든 없든 안전하며(자식을 먼저 지우므로 제약 위반이 없다), 동작은 동일하다.
 *
 * 반대 방향(notifications → users/beaches/notification_templates)은 이 배치와 무관하다.
 * 알림만 지우므로 사용자/해변/템플릿은 그대로 남는다.
 */
@Injectable()
export class NotificationPurgePrismaRepository implements NotificationPurgePort {
  private readonly logger = new Logger(NotificationPurgePrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeOlderThan(cutoff: Date, now: Date, batchSize: number): Promise<number> {
    let total = 0;

    for (;;) {
      // 지울 대상 id 를 먼저 배치 크기만큼 집어온다.
      // (MySQL 은 다중 테이블 DELETE 에서 ORDER BY/LIMIT 을 허용하지 않아 한 방에 못 지운다)
      //
      // cooldown_until 이 아직 미래인 알림은 남긴다(NOTI-003 중복 방지 유지).
      // 보관 기간(기본 90일)이 쿨다운(분~시간 단위)보다 훨씬 길어 실제로 걸릴 일은 없지만,
      // 보관 일수를 짧게 조정했을 때 dedup 이 조용히 풀리는 것을 막는 안전장치다.
      const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM notifications
        WHERE created_at < ${cutoff}
          AND (cooldown_until IS NULL OR cooldown_until < ${now})
        ORDER BY id
        LIMIT ${batchSize}
      `;

      if (rows.length === 0) {
        break;
      }

      const ids = rows.map((row) => row.id);

      // 자식 먼저. 운영 DB 에 FK 가 없어 CASCADE 가 돌지 않으므로 직접 지워야 한다.
      const dispatches = await this.prisma.notificationDispatch.deleteMany({
        where: { notificationId: { in: ids } },
      });

      const deleted = await this.prisma.notification.deleteMany({
        where: { id: { in: ids } },
      });

      total += deleted.count;
      if (dispatches.count > 0) {
        this.logger.debug(`발송 이력 ${dispatches.count}행 함께 파기`);
      }

      if (rows.length < batchSize) {
        break;
      }
      this.logger.debug(`알림 파기 진행 중: 누적 ${total}행`);
    }

    return total;
  }
}
