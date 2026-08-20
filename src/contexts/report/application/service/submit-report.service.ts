import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import { Id } from '@shared/kernel/id';
import { JellyfishReport } from '../../domain/jellyfish-report';
import {
  BeachCandidate,
  NEAREST_BEACH_RADIUS_KM,
  assignBeachByProximity,
} from '../../domain/nearest-beach';
import {
  BeachAssignment,
  ProcessVisionUseCase,
  PROCESS_VISION_USE_CASE,
  SubmitReportCommand,
  SubmitReportResult,
  SubmitReportUseCase,
} from '../port/in/report-use-cases';
import { BeachLocationPort, BEACH_LOCATION } from '../port/out/beach-location.port';
import { ReportRepositoryPort, REPORT_REPOSITORY } from '../port/out/report-repository.port';

/** 접수 시점에 확정된 해변 배정 결과. */
interface ResolvedBeach {
  beachId: Id | null;
  beachName: string | null;
  assignment: BeachAssignment;
  /** 자동 배정된 경우에만 채운다(사용자가 고른 해변은 거리 개념이 없다). */
  distanceKm: number | null;
}

const UNASSIGNED: ResolvedBeach = {
  beachId: null,
  beachName: null,
  assignment: 'none',
  distanceKm: null,
};

/**
 * USR-004 해파리 발견 제보.
 * 제보를 received 로 저장(동의 연결 포함)하고 AI 판별을 비동기로 트리거한다.
 * 응답은 aiStatus=pending 이며, 실제 판별은 ProcessVision 이 이어서 처리한다.
 *
 * REPORT-005: 해변을 고르지 않고 좌표만 온 제보는 최근접 활성 해변을 자동 배정한다.
 * 배정하지 않으면 beach_id 가 NULL 로 남고, 위험도 산출이 beach_id 로만 제보를 집계하기 때문에
 * 그 제보는 **어느 해변의 위험도에도 반영되지 않는다**(실제로 운영 데이터가 그 상태였다).
 */
@Injectable()
export class SubmitReportService implements SubmitReportUseCase {
  private readonly logger = new Logger(SubmitReportService.name);

  private readonly config: AppConfig;

  constructor(
    @Inject(REPORT_REPOSITORY) private readonly repository: ReportRepositoryPort,
    @Inject(PROCESS_VISION_USE_CASE) private readonly processVision: ProcessVisionUseCase,
    @Inject(BEACH_LOCATION) private readonly beachLocations: BeachLocationPort,
    configService: ConfigService,
  ) {
    this.config = new AppConfig(configService);
  }

  async submit(command: SubmitReportCommand): Promise<SubmitReportResult> {
    const now = new Date();
    const beach = await this.resolveBeach(command);

    const report = JellyfishReport.create(
      {
        beachId: beach.beachId,
        reporterUserId: command.reporterUserId,
        reporterToken: command.reporterToken,
        lat: command.lat,
        lng: command.lng,
        imageUrl: command.imageUrl,
        thumbnailUrl: command.thumbnailUrl ?? null,
        reportType: command.reportType,
        occurredAt: command.occurredAt,
      },
      now,
    );

    // PRIV-003: 저장 전에 파기 예정 시각을 지정해 최초 insert 에 함께 반영한다.
    const purgeAt = new Date(
      now.getTime() + this.config.reportRetentionDays * 24 * 60 * 60 * 1000,
    );
    report.schedulePurge(purgeAt);

    const saved = await this.repository.save(
      report,
      command.consentLogIds.map((consentLogId) => ({ consentLogId })),
    );
    const reportId = saved.id!;

    // AI 판별은 응답을 막지 않도록 백그라운드로 시작한다(fire-and-forget).
    // 실패해도 processPending 스케줄러가 다시 집어간다.
    void this.processVision.process(reportId).catch((err) => {
      this.logger.warn(`제보 ${reportId} AI 판별 트리거 실패(스케줄러가 재처리): ${err}`);
    });

    return {
      reportId,
      status: saved.status,
      aiStatus: 'pending',
      beachId: saved.beachId,
      beachName: beach.beachName,
      beachAssignment: beach.assignment,
      beachDistanceKm: beach.distanceKm,
    };
  }

  /**
   * 이 제보를 어느 해변에 붙일지 결정한다.
   *
   *  - 사용자가 beachId 를 명시했으면 그대로 존중한다(자동 배정하지 않는다).
   *  - 좌표만 있으면 최근접 활성 해변을 찾는다. 반경 상한(NEAREST_BEACH_RADIUS_KM) 이내일 때만 배정한다.
   *  - 상한 밖이면 억지로 붙이지 않고 NULL 로 남긴다 — 도심 제보가 십수 km 떨어진 해변에
   *    계상되는 것이 미반영보다 더 나쁘다(위험도를 잘못 올린다).
   *
   * 해변 조회가 실패해도 제보 접수 자체는 막지 않는다(배정만 포기).
   */
  private async resolveBeach(command: SubmitReportCommand): Promise<ResolvedBeach> {
    const userBeachId = command.beachId ?? null;

    // 해변 마스터 좌표(십여 건). 조회가 실패해도 접수는 계속한다.
    let candidates: BeachCandidate[] = [];
    try {
      candidates = await this.beachLocations.listBeachLocations();
    } catch (err) {
      this.logger.warn(`해변 좌표 조회 실패(자동 배정 생략): ${err}`);
    }

    // (1) 사용자가 고른 해변은 그대로 존중한다. 자동 배정하지 않는다.
    if (userBeachId !== null) {
      const picked = candidates.find((c) => c.beachId === userBeachId) ?? null;
      return {
        beachId: userBeachId,
        beachName: picked?.name ?? null,
        assignment: 'user',
        distanceKm: null,
      };
    }

    // (2) 좌표만 온 제보 → 최근접 활성 해변 자동 배정(반경 상한 이내일 때만).
    if (command.lat === null || command.lng === null) {
      // 도메인 불변식상 해변/좌표 중 하나는 반드시 있으므로 실제로는 도달하지 않는다.
      return UNASSIGNED;
    }

    const point = { lat: command.lat, lng: command.lng };
    const nearest = assignBeachByProximity(point, candidates);

    if (!nearest) {
      this.logger.log(
        `제보 좌표(${point.lat}, ${point.lng}): 반경 ${NEAREST_BEACH_RADIUS_KM}km 안에 활성 해변이 없어 beach_id 없이 접수한다.`,
      );
      return UNASSIGNED;
    }

    this.logger.log(
      `제보 좌표(${point.lat}, ${point.lng}) → ${nearest.name}(id=${nearest.beachId}, ${nearest.distanceKm}km) 자동 배정.`,
    );
    return {
      beachId: nearest.beachId,
      beachName: nearest.name,
      assignment: 'auto',
      distanceKm: nearest.distanceKm,
    };
  }
}
