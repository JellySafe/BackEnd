import { Inject, Injectable, Logger } from '@nestjs/common';
import { Page, PageRequest } from '@shared/kernel/pagination';
import { Id } from '@shared/kernel/id';
import {
  ListGroundtruthUseCase,
  RecordFieldObservationCommand,
  RecordFieldObservationResult,
  RecordFieldObservationUseCase,
  RecordStingIncidentCommand,
  RecordStingIncidentResult,
  RecordStingIncidentUseCase,
} from '../port/in/groundtruth-use-cases';
import {
  FIELD_OBSERVATION_REPOSITORY,
  FieldObservationFilter,
  FieldObservationRepositoryPort,
  FieldObservationRow,
  GROUNDTRUTH_QUERY,
  GroundtruthQueryPort,
  STING_INCIDENT_REPOSITORY,
  StingIncidentRepositoryPort,
  StingIncidentRow,
} from '../port/out/groundtruth-ports';
import { FieldObservation } from '../../domain/field-observation';
import { StingIncident } from '../../domain/sting-incident';

/**
 * 정답 데이터 기록·조회.
 *
 * 세 유스케이스(관측 기록·사고 기록·목록)를 한 서비스가 맡는다. 셋 다 같은 저장소를 감싸는
 * 얇은 흐름이고, 나누면 파일만 늘고 읽는 사람이 오간다. 규칙이 생기면 그때 쪼갠다.
 */
@Injectable()
export class RecordGroundtruthService
  implements RecordFieldObservationUseCase, RecordStingIncidentUseCase, ListGroundtruthUseCase
{
  private readonly logger = new Logger(RecordGroundtruthService.name);

  constructor(
    @Inject(FIELD_OBSERVATION_REPOSITORY)
    private readonly observations: FieldObservationRepositoryPort,
    @Inject(STING_INCIDENT_REPOSITORY)
    private readonly incidents: StingIncidentRepositoryPort,
    @Inject(GROUNDTRUTH_QUERY) private readonly query: GroundtruthQueryPort,
  ) {}

  /** 현장 관측 기록. 도메인이 부재/밀도 불변식을 강제한다. */
  async recordObservation(
    command: RecordFieldObservationCommand,
  ): Promise<RecordFieldObservationResult> {
    const observation = FieldObservation.create(
      {
        beachId: command.beachId,
        observedAt: command.observedAt,
        source: command.source,
        jellyfishPresent: command.jellyfishPresent,
        densityLevel: command.densityLevel ?? null,
        speciesId: command.speciesId ?? null,
        estimatedCount: command.estimatedCount ?? null,
        observerId: command.observerId,
        observerName: command.observerName ?? null,
        note: command.note ?? null,
      },
      new Date(),
    );

    const observationId = await this.observations.saveObservation(observation);
    return { observationId };
  }

  /**
   * 쏘임 사고 기록.
   *
   * 외부 식별자가 같은 사고가 이미 있으면 **저장은 하되 표시를 올린다.** 기계가 병합하면
   * 시각·인원이 조금씩 다른 두 기록이 합쳐지면서 사고 건수가 조용히 줄어든다.
   */
  async recordIncident(command: RecordStingIncidentCommand): Promise<RecordStingIncidentResult> {
    const incident = StingIncident.create(
      {
        beachId: command.beachId,
        occurredAt: command.occurredAt,
        source: command.source,
        severity: command.severity,
        patientCount: command.patientCount,
        speciesId: command.speciesId ?? null,
        externalRef: command.externalRef ?? null,
        note: command.note ?? null,
        reportedBy: command.reportedBy,
      },
      new Date(),
    );

    const externalRef = incident.externalRef;
    const possibleDuplicate =
      externalRef === null ? false : await this.incidents.existsByExternalRef(externalRef);

    if (possibleDuplicate) {
      this.logger.warn(
        `외부 식별자 '${externalRef}' 의 사고가 이미 있다. 저장은 했으니 중복인지 사람이 확인한다.`,
      );
    }

    const incidentId = await this.incidents.saveIncident(incident);
    return { incidentId, possibleDuplicate };
  }

  listObservations(
    filter: FieldObservationFilter,
    page: PageRequest,
  ): Promise<Page<FieldObservationRow>> {
    return this.query.listObservations(filter, page);
  }

  listIncidents(
    filter: { beachId?: Id; from?: Date; to?: Date },
    page: PageRequest,
  ): Promise<Page<StingIncidentRow>> {
    return this.query.listIncidents(filter, page);
  }
}
