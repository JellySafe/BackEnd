import { Inject, Injectable, Logger } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { AUDIT_PORT, AuditPort } from '../port/out/audit.port';
import {
  CalculateRiskUseCase,
  CALCULATE_RISK_USE_CASE,
  CreateRiskOverrideCommand,
  CreateRiskOverrideUseCase,
  ListRiskOverridesUseCase,
  ReleaseRiskOverrideUseCase,
  RiskOverrideListItem,
  RiskOverrideResult,
} from '../port/in/risk-use-cases';
import {
  RISK_OVERRIDE_REPOSITORY,
  RiskOverrideRepositoryPort,
} from '../port/out/risk-override-repository.port';
import { RISK_PERSISTENCE, RiskPersistencePort } from '../port/out/risk-persistence.port';
import { RiskOverride } from '../../domain/risk-override';

/** 목록 기본 개수. 운영 화면 한 장에 들어가는 양이다. */
const LIST_LIMIT = 100;

/**
 * 운영자 수동 등급 상향 — 생성 / 해제 / 조회.
 *
 * ── 왜 저장만 하고 끝내지 않나 ───────────────────────────────────────────────────────
 * 상향을 저장해도 **다음 배치(최대 30분 뒤)까지는 화면이 그대로다.** 현장이 위험을 알리려고
 * 누른 버튼이 30분 뒤에 반영되는 것은 이 기능의 목적을 배반한다. 그래서 저장 직후 그 해변만
 * 다시 산출한다 — 제보 검수(ADM-009)가 이미 쓰는 경로와 같다.
 *
 * 해제도 마찬가지다. 위험이 지나갔는데 다음 배치까지 '위험' 이 남아 있으면 신뢰를 잃는다.
 *
 * ── 왜 감사 로그를 남기나 ────────────────────────────────────────────────────────────
 * 이건 **사람이 시민에게 보이는 위험 단계를 직접 바꾸는** 유일한 경로다. 누가 언제 무엇을
 * 근거로 올렸는지가 남지 않으면 나중에 그 판단을 검토할 수 없다. 저장 실패는 상향 자체를
 * 막지 않는다 — 기록이 안 남는 것보다 상향이 안 걸리는 쪽이 더 위험하다.
 */
@Injectable()
export class ManageRiskOverrideService
  implements CreateRiskOverrideUseCase, ReleaseRiskOverrideUseCase, ListRiskOverridesUseCase
{
  private readonly logger = new Logger(ManageRiskOverrideService.name);

  constructor(
    @Inject(RISK_OVERRIDE_REPOSITORY) private readonly repository: RiskOverrideRepositoryPort,
    @Inject(CALCULATE_RISK_USE_CASE) private readonly calculateRisk: CalculateRiskUseCase,
    // 읽기 하나(findLatestLevel)에 persistence 포트를 쓴다 — 산출 서비스가 쓰는 것과 같은
    // 자리라 여기만 다른 포트로 가져오면 두 곳이 서로 다른 '현재 단계' 를 볼 수 있다.
    @Inject(RISK_PERSISTENCE) private readonly persistence: RiskPersistencePort,
    @Inject(AUDIT_PORT) private readonly auditLog: AuditPort,
  ) {}

  async create(command: CreateRiskOverrideCommand): Promise<RiskOverrideResult> {
    const now = new Date();

    // 도메인이 막는다 — 'safe' 상향 불가, 사유 필수, 기간 상한(risk-override.ts).
    const override = RiskOverride.create({
      beachId: command.beachId,
      minRiskLevel: command.minRiskLevel,
      reason: command.reason,
      createdBy: command.createdBy,
      durationHours: command.durationHours,
      now,
    });

    const saved = await this.repository.save(override);
    this.logger.warn(
      `수동 등급 상향 (beachId=${command.beachId}, ${saved.describe()}, 지시자=${command.createdBy ?? '미상'})`,
    );

    await this.record(command.createdBy, 'risk_override_create', saved.id ?? null, {
      beachId: command.beachId,
      minRiskLevel: saved.minRiskLevel,
      reason: command.reason,
      expiresAt: saved.expiresAt.toISOString(),
    });

    return this.applyAndDescribe(saved, command.createdBy, 'manual');
  }

  async release(overrideId: Id, releasedBy: Id | null): Promise<RiskOverrideResult> {
    const override = await this.repository.findById(overrideId);
    if (!override) {
      throw new NotFoundError('RISK_OVERRIDE_NOT_FOUND', '상향 기록을 찾을 수 없습니다.', {
        overrideId,
      });
    }

    override.release(releasedBy, new Date());
    const saved = await this.repository.update(override);
    this.logger.log(`수동 등급 상향 해제 (overrideId=${overrideId}, 해제자=${releasedBy ?? '미상'})`);

    await this.record(releasedBy, 'risk_override_release', overrideId, {
      beachId: saved.beachId,
      releasedAt: saved.releasedAt?.toISOString() ?? null,
    });

    return this.applyAndDescribe(saved, releasedBy, 'manual');
  }

  list(filter: { beachId: Id | null; activeOnly: boolean }): Promise<RiskOverrideListItem[]> {
    return this.repository.list({
      beachId: filter.beachId,
      activeOnly: filter.activeOnly,
      now: new Date(),
      limit: LIST_LIMIT,
    });
  }

  /**
   * 그 해변만 다시 산출하고, 반영된 현재 단계를 함께 돌려준다.
   *
   * 재산출이 실패해도 **상향 자체는 이미 저장됐다.** 다음 배치가 반영하므로 여기서 예외를
   * 던져 요청을 실패시키면, 운영자는 "실패했다" 고 읽고 다시 누른다 — 같은 상향이 두 벌
   * 쌓인다. 경고만 남기고 현재 단계는 모른다고 답하는 편이 정확하다.
   */
  private async applyAndDescribe(
    override: RiskOverride,
    actor: Id | null,
    triggerType: 'manual',
  ): Promise<RiskOverrideResult> {
    let currentLevel: string | null = null;
    try {
      await this.calculateRisk.calculate({
        beachId: override.beachId,
        triggerType,
        triggeredBy: actor,
      });
      currentLevel = await this.persistence.findLatestLevel(override.beachId, 'now');
    } catch (err) {
      this.logger.error(
        `상향 반영을 위한 재산출 실패 (beachId=${override.beachId}). 상향은 저장됐고 다음 배치가 반영한다: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    return {
      overrideId: override.id!,
      beachId: override.beachId,
      minRiskLevel: override.minRiskLevel,
      expiresAt: override.expiresAt,
      currentLevel,
    };
  }

  /** 감사 로그. 실패해도 본 작업을 막지 않는다(기록보다 상향이 걸리는 것이 먼저다). */
  private async record(
    userId: Id | null,
    actionType: string,
    targetId: Id | null,
    afterJson: unknown,
  ): Promise<void> {
    try {
      await this.auditLog.record({
        userId,
        actionType,
        targetType: 'risk_override',
        targetId,
        afterJson,
      });
    } catch (err) {
      this.logger.warn(
        `감사 로그 기록 실패 (${actionType}): ` + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
