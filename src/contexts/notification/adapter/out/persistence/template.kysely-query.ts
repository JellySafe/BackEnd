import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { RiskLevel } from '@shared/kernel/risk-level';
import { NotificationEvent, NotificationTarget } from '../../../domain/notification-enums';
import {
  TemplateCriteria,
  TemplateQueryPort,
  TemplateRecord,
} from '../../../application/port/out/template-query.port';

interface TemplateRow {
  id: number;
  templateCode: string;
  targetType: string;
  riskLevel: string | null;
  eventType: string | null;
  title: string | null;
  body: string;
}

function toRecord(row: TemplateRow): TemplateRecord {
  return {
    id: Number(row.id),
    templateCode: row.templateCode,
    targetType: row.targetType as NotificationTarget,
    riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
    eventType: (row.eventType as NotificationEvent | null) ?? null,
    title: row.title,
    body: row.body,
  };
}

/**
 * 알림 템플릿 조회 어댑터 (Kysely). notification_templates 매칭 조회.
 * 치환은 도메인(renderMessage)에서 하고 여기서는 조회만 담당한다.
 */
const TEMPLATE_COLUMNS = [
  't.id as id',
  't.template_code as templateCode',
  't.target_type as targetType',
  't.risk_level as riskLevel',
  't.event_type as eventType',
  't.title as title',
  't.body as body',
] as const;

@Injectable()
export class TemplateKyselyQuery implements TemplateQueryPort {
  constructor(private readonly db: KyselyService) {}

  async findByCode(templateCode: string): Promise<TemplateRecord | null> {
    const row = await this.db
      .selectFrom('notification_templates as t')
      .select(TEMPLATE_COLUMNS)
      .where('t.template_code', '=', templateCode)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findMatch(criteria: TemplateCriteria): Promise<TemplateRecord | null> {
    let q = this.db
      .selectFrom('notification_templates as t')
      .select(TEMPLATE_COLUMNS)
      .where('t.active', '=', 1)
      .where('t.target_type', '=', criteria.targetType)
      // 이벤트는 정확 매칭 또는 무관(NULL) 템플릿 허용.
      .where((eb) =>
        eb.or([eb('t.event_type', '=', criteria.eventType), eb('t.event_type', 'is', null)]),
      );

    // riskLevel: 정확 매칭 또는 단계 무관(NULL) 템플릿 허용.
    const level = criteria.riskLevel;
    if (level !== null) {
      q = q.where((eb) =>
        eb.or([eb('t.risk_level', '=', level), eb('t.risk_level', 'is', null)]),
      );
    } else {
      q = q.where('t.risk_level', 'is', null);
    }

    // 더 구체적인(NULL 이 아닌) 매칭을 우선한다.
    const row = await q
      .orderBy(sql`t.risk_level is null`, 'asc')
      .orderBy(sql`t.event_type is null`, 'asc')
      .limit(1)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async listActive(targetType?: NotificationTarget): Promise<TemplateRecord[]> {
    let q = this.db
      .selectFrom('notification_templates as t')
      .select(TEMPLATE_COLUMNS)
      .where('t.active', '=', 1);
    if (targetType) q = q.where('t.target_type', '=', targetType);
    const rows = await q.orderBy('t.template_code', 'asc').execute();
    return rows.map((r) => toRecord(r));
  }
}
