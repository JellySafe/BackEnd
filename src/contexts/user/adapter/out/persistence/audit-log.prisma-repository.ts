import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { Id, toId } from '@shared/kernel/id';
import {
  AuditLogRecord,
  AuditLogRepositoryPort,
} from '../../../application/port/out/audit-log-repository.port';

/**
 * 감사 로그 영속성 어댑터 (Prisma). audit_logs INSERT 전용 (AUTH-002).
 */
@Injectable()
export class AuditLogPrismaRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: AuditLogRecord): Promise<Id> {
    const row = await this.prisma.auditLog.create({
      data: {
        userId: record.userId === null ? null : BigInt(record.userId),
        actionType: record.actionType,
        targetType: record.targetType,
        targetId: record.targetId === null ? null : BigInt(record.targetId),
        beforeJson:
          record.beforeJson === null ? Prisma.JsonNull : (record.beforeJson as Prisma.InputJsonValue),
        afterJson:
          record.afterJson === null ? Prisma.JsonNull : (record.afterJson as Prisma.InputJsonValue),
        ipAddress: record.ipAddress,
      },
    });
    return toId(row.id);
  }
}
