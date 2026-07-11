import { Injectable } from '@nestjs/common';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { Id } from '@shared/kernel/id';
import { Page, PageRequest, offsetOf, toPage } from '@shared/kernel/pagination';
import { OperationStatus } from '../../../domain/operation-enums';
import {
  OperationActionListItem,
  OperationQueryPort,
  OperationStatusView,
} from '../../../application/port/out/operation-query.port';

/**
 * 운영 대응 이력 조회 어댑터 (Kysely). 기록자 조인 + 페이지네이션.
 */
@Injectable()
export class OperationKyselyQuery implements OperationQueryPort {
  constructor(private readonly db: KyselyService) {}

  async listByBeach(beachId: Id, page: PageRequest): Promise<Page<OperationActionListItem>> {
    const base = this.db
      .selectFrom('operation_actions as oa')
      .leftJoin('users as u', 'u.id', 'oa.created_by')
      .where('oa.beach_id', '=', beachId);

    const countRow = await base
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .executeTakeFirst();
    const total = Number(countRow?.cnt ?? 0);

    const rows = await base
      .select([
        'oa.id as actionId',
        'oa.beach_id as beachId',
        'oa.operation_status as operationStatus',
        'oa.action_type as actionType',
        'oa.memo as memo',
        'oa.risk_score_id as riskScoreId',
        'oa.recommendation_id as recommendationId',
        'oa.created_by as createdBy',
        'u.name as createdByName',
        'oa.created_at as createdAt',
      ])
      .orderBy('oa.created_at', 'desc')
      .limit(page.size)
      .offset(offsetOf(page))
      .execute();

    const items: OperationActionListItem[] = rows.map((row) => ({
      actionId: Number(row.actionId),
      beachId: Number(row.beachId),
      operationStatus: row.operationStatus as OperationStatus,
      actionType: row.actionType ?? null,
      memo: row.memo ?? null,
      riskScoreId: row.riskScoreId === null ? null : Number(row.riskScoreId),
      recommendationId: row.recommendationId === null ? null : Number(row.recommendationId),
      createdBy: Number(row.createdBy),
      createdByName: row.createdByName ?? null,
      createdAt: new Date(row.createdAt),
    }));

    return toPage(items, total, page);
  }

  async findLatestByBeach(beachId: Id): Promise<OperationStatusView | null> {
    const row = await this.db
      .selectFrom('operation_actions as oa')
      .leftJoin('users as u', 'u.id', 'oa.created_by')
      .where('oa.beach_id', '=', beachId)
      .select([
        'oa.beach_id as beachId',
        'oa.operation_status as operationStatus',
        'oa.action_type as actionType',
        'oa.created_by as createdBy',
        'u.name as createdByName',
        'oa.created_at as createdAt',
      ])
      .orderBy('oa.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!row) return null;

    return {
      beachId: Number(row.beachId),
      operationStatus: row.operationStatus as OperationStatus,
      actionType: row.actionType ?? null,
      createdBy: Number(row.createdBy),
      createdByName: row.createdByName ?? null,
      createdAt: new Date(row.createdAt),
    };
  }
}
