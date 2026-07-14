import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { NotificationPurgePort } from '../../../application/port/out/notification-purge.port';

/**
 * 알림 파기 어댑터 (NotificationPurgePort 구현).
 *
 * ── FK 확인 ────────────────────────────────────────────────────────────────────────
 * notifications 를 참조하는 테이블은 notification_dispatches 하나뿐이고
 * fk_notification_dispatches_notification 이 ON DELETE CASCADE 다.
 * 알림을 지우면 그 알림의 발송 이력도 함께 지워진다 — 발송 이력은 알림에 종속된
 * 자식 레코드이므로 의도한 동작이다(2차 기능이라 MVP 에서는 아직 0행).
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
      // 단일 테이블 DELETE 를 쓴다. MySQL 은 다중 테이블 DELETE 에서 ORDER BY / LIMIT 을
      // 허용하지 않는다(문법 오류). 배치로 끊어 지우려면 이 형태여야 한다.
      //
      // cooldown_until 이 아직 미래인 알림은 남긴다(NOTI-003 중복 방지 유지).
      // 보관 기간(기본 90일)이 쿨다운(분~시간 단위)보다 훨씬 길어 실제로 걸릴 일은 없지만,
      // 보관 일수를 짧게 조정했을 때 dedup 이 조용히 풀리는 것을 막는 안전장치다.
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM notifications
        WHERE created_at < ${cutoff}
          AND (cooldown_until IS NULL OR cooldown_until < ${now})
        ORDER BY id
        LIMIT ${batchSize}
      `;

      total += deleted;
      if (deleted < batchSize) {
        break;
      }
      this.logger.debug(`알림 파기 진행 중: 누적 ${total}행`);
    }

    return total;
  }
}
