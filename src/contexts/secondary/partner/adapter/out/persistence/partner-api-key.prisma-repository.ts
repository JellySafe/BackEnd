import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toBigInt, toId } from '@shared/kernel/id';
import { normalizeScopes, StoredApiKey } from '../../../domain/partner-api-key';
import {
  ApiKeySummary,
  PartnerApiKeyRepositoryPort,
  RecordCallInput,
  SaveApiKeyInput,
} from '../../../application/port/out/partner-api-key-repository.port';

/**
 * 제휴사 API 키 영속성 어댑터 (Prisma, EX-001).
 */
@Injectable()
export class PartnerApiKeyPrismaRepository implements PartnerApiKeyRepositoryPort {
  private readonly logger = new Logger(PartnerApiKeyPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveApiKeyInput): Promise<ApiKeySummary> {
    const row = await this.prisma.partnerApiKey.create({
      data: {
        partnerId: toBigInt(input.partnerId),
        keyPrefix: input.keyPrefix,
        apiKeyHash: input.apiKeyHash,
        scopesJson: input.scopes,
        rateLimitPerMin: input.rateLimitPerMin,
        expiresAt: input.expiresAt,
      },
    });
    return toSummary(row);
  }

  async findByPrefix(keyPrefix: string): Promise<StoredApiKey | null> {
    const row = await this.prisma.partnerApiKey.findUnique({
      where: { keyPrefix },
      include: { partner: { select: { partnerStatus: true } } },
    });
    if (row === null) return null;

    return {
      apiKeyId: toId(row.id),
      partnerId: toId(row.partnerId),
      keyPrefix: row.keyPrefix,
      apiKeyHash: row.apiKeyHash,
      scopes: normalizeScopes(row.scopesJson),
      rateLimitPerMin: row.rateLimitPerMin,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      partnerStatus: row.partner.partnerStatus,
    };
  }

  async listByPartner(partnerId: Id): Promise<ApiKeySummary[]> {
    const rows = await this.prisma.partnerApiKey.findMany({
      where: { partnerId: toBigInt(partnerId) },
      orderBy: { id: 'desc' },
    });
    return rows.map(toSummary);
  }

  async revoke(apiKeyId: Id, now: Date): Promise<boolean> {
    // updateMany + revokedAt: null 조건이라 두 번 눌러도 예외가 아니다(두 번째는 0건).
    const result = await this.prisma.partnerApiKey.updateMany({
      where: { id: toBigInt(apiKeyId), revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count > 0;
  }

  /**
   * 호출 로그. **예외를 밖으로 던지지 않는다** — 로그를 남기지 못했다고 제휴사에게 500 을
   * 돌려주면, 우리 부가 기능의 문제로 남의 서비스가 멈춘다. 기록 실패는 우리 쪽 로그로 남긴다.
   */
  async recordCall(input: RecordCallInput): Promise<void> {
    try {
      await this.prisma.partnerApiCallLog.create({
        data: {
          partnerId: toBigInt(input.partnerId),
          apiKeyId: input.apiKeyId === null ? null : toBigInt(input.apiKeyId),
          endpoint: input.endpoint.slice(0, 255),
          httpMethod: input.httpMethod.slice(0, 10),
          statusCode: input.statusCode,
          responseTimeMs: input.responseTimeMs,
          isBillable: input.isBillable,
          calledAt: input.calledAt,
        },
      });
    } catch (err) {
      this.logger.error(
        `제휴 API 호출 로그 기록 실패(과금 집계에서 누락된다): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function toSummary(row: {
  id: bigint;
  partnerId: bigint;
  keyPrefix: string;
  scopesJson: Prisma.JsonValue;
  rateLimitPerMin: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ApiKeySummary {
  return {
    apiKeyId: toId(row.id),
    partnerId: toId(row.partnerId),
    keyPrefix: row.keyPrefix,
    scopes: normalizeScopes(row.scopesJson),
    rateLimitPerMin: row.rateLimitPerMin,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
