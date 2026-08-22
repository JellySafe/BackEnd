import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { Id, toId } from '@shared/kernel/id';
import { FieldObservation } from '../../../domain/field-observation';
import { StingIncident } from '../../../domain/sting-incident';
import {
  EvaluationRecord,
  EvaluationRepositoryPort,
  FieldObservationRepositoryPort,
  StingIncidentRepositoryPort,
} from '../../../application/port/out/groundtruth-ports';

/**
 * 정답 데이터 쓰기 어댑터 (Prisma).
 *
 * 관측·사고·대조 결과의 저장을 한 클래스가 맡는다. 세 테이블은 같은 목적(정답 데이터)으로
 * 함께 움직이고, 각각을 파일로 쪼개면 얇은 래퍼가 셋 생길 뿐이다.
 */
@Injectable()
export class GroundtruthPrismaRepository
  implements FieldObservationRepositoryPort, StingIncidentRepositoryPort, EvaluationRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async saveObservation(observation: FieldObservation): Promise<Id> {
    const s = observation.snapshot();
    const row = await this.prisma.fieldObservation.create({
      data: {
        beachId: BigInt(s.beachId),
        observedAt: s.observedAt,
        source: s.source,
        observerId: s.observerId === null ? null : BigInt(s.observerId),
        observerName: s.observerName,
        jellyfishPresent: s.jellyfishPresent,
        densityLevel: s.densityLevel,
        speciesId: s.speciesId === null ? null : BigInt(s.speciesId),
        estimatedCount: s.estimatedCount,
        note: s.note,
      },
    });
    return toId(row.id);
  }

  async saveIncident(incident: StingIncident): Promise<Id> {
    const s = incident.snapshot();
    const row = await this.prisma.stingIncident.create({
      data: {
        beachId: BigInt(s.beachId),
        occurredAt: s.occurredAt,
        source: s.source,
        severity: s.severity,
        patientCount: s.patientCount,
        speciesId: s.speciesId === null ? null : BigInt(s.speciesId),
        externalRef: s.externalRef,
        note: s.note,
        reportedBy: s.reportedBy === null ? null : BigInt(s.reportedBy),
      },
    });
    return toId(row.id);
  }

  async existsByExternalRef(externalRef: string): Promise<boolean> {
    const found = await this.prisma.stingIncident.findFirst({
      where: { externalRef },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * 대조 결과를 (해변, 날짜) 단위로 덮어쓴다.
   *
   * `upsert` 를 건별로 도는 이유: MySQL 에서 Prisma 는 `createMany` 의 upsert 를 지원하지
   * 않는다. 대상은 하루치(해변 수만큼)라 건수가 작고, 한 트랜잭션으로 묶어 부분 반영을 막는다.
   */
  async upsertMany(records: EvaluationRecord[]): Promise<number> {
    if (records.length === 0) return 0;

    await this.prisma.$transaction(
      records.map((r) => {
        const data = {
          predictedLevel: r.predictedLevel,
          predictedScore: r.predictedScore,
          observed: r.observed,
          actualDensity: r.actualDensity,
          incidentCount: r.incidentCount,
          outcome: r.outcome,
          alertThreshold: r.alertThreshold,
          ruleVersion: r.ruleVersion,
          evaluatedAt: new Date(),
        };
        return this.prisma.predictionEvaluation.upsert({
          where: {
            uk_prediction_evaluations_beach_date: {
              beachId: BigInt(r.beachId),
              targetDate: r.targetDate,
            },
          },
          create: { beachId: BigInt(r.beachId), targetDate: r.targetDate, ...data },
          update: data,
        });
      }),
    );

    return records.length;
  }
}
