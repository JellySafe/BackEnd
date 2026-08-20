import { ConfigService } from '@nestjs/config';
import { JellyfishReport } from '../../domain/jellyfish-report';
import { BeachCandidate } from '../../domain/nearest-beach';
import { SubmitReportCommand } from '../port/in/report-use-cases';
import { BeachLocationPort } from '../port/out/beach-location.port';
import { ConsentLink, ReportRepositoryPort } from '../port/out/report-repository.port';
import { SubmitReportService } from './submit-report.service';

/** 운영 DB(beaches)의 실제 좌표. */
const BEACHES: BeachCandidate[] = [
  { beachId: 1, name: '협재해수욕장', lat: 33.3941, lng: 126.2396, isActive: true },
  { beachId: 2, name: '함덕해수욕장', lat: 33.5432, lng: 126.6698, isActive: true },
  { beachId: 4, name: '중문색달해수욕장', lat: 33.2447, lng: 126.4103, isActive: true },
  { beachId: 7, name: '금능으뜸원해수욕장', lat: 33.3889, lng: 126.2372, isActive: true },
];

/** 함덕해수욕장에서 54m 떨어진 실제 제보 좌표. */
const HAMDEOK_POINT = { lat: 33.5430616, lng: 126.6692389 };
/** 서귀포 도심 — 최근접 해변(중문색달)까지 13.4km. */
const SEOGWIPO_DOWNTOWN = { lat: 33.2472123, lng: 126.5545223 };

function command(overrides: Partial<SubmitReportCommand> = {}): SubmitReportCommand {
  return {
    beachId: null,
    reporterUserId: null,
    reporterToken: 'guest-test',
    lat: HAMDEOK_POINT.lat,
    lng: HAMDEOK_POINT.lng,
    imageUrl: '/uploads/test.jpg',
    reportType: 'general',
    occurredAt: new Date('2026-07-13T23:20:00.000Z'),
    consentLogIds: [1],
    ...overrides,
  };
}

describe('SubmitReportService (REPORT-005 최근접 해변 자동 배정)', () => {
  function setup(candidates: BeachCandidate[] | Error = BEACHES) {
    // 저장된 제보를 그대로 되돌려주되 id 만 부여한다(실제 리포지토리와 동일한 동작).
    const save = jest.fn(async (report: JellyfishReport, _consents: ConsentLink[]) => {
      const snapshot = report.snapshot();
      return JellyfishReport.reconstitute({ ...snapshot, id: 1024 });
    });
    const repository = { save } as unknown as ReportRepositoryPort;

    const listBeachLocations = jest.fn(async () => {
      if (candidates instanceof Error) throw candidates;
      return candidates;
    });
    const beachLocations: BeachLocationPort = { listBeachLocations };

    const processVision = { process: jest.fn().mockResolvedValue(undefined), processPending: jest.fn() };

    const service = new SubmitReportService(
      repository,
      processVision,
      beachLocations,
      new ConfigService({}),
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    return { service, save, listBeachLocations };
  }

  /** save 에 넘어간 제보의 beach_id (실제로 DB 에 들어갈 값). */
  function savedBeachId(save: jest.Mock): number | null {
    const report = save.mock.calls[0][0] as JellyfishReport;
    return report.beachId;
  }

  it('좌표만 온 제보(반경 안)는 최근접 활성 해변을 자동 배정해 저장한다', async () => {
    const { service, save } = setup();

    const result = await service.submit(command());

    expect(savedBeachId(save)).toBe(2); // 함덕
    expect(result.beachId).toBe(2);
    expect(result.beachName).toBe('함덕해수욕장');
    expect(result.beachAssignment).toBe('auto');
    expect(result.beachDistanceKm).toBeCloseTo(0.054, 2);
  });

  it('반경 밖(서귀포 도심, 최근접 13.4km)이면 배정하지 않고 beach_id 를 NULL 로 둔다', async () => {
    const { service, save } = setup();

    const result = await service.submit(command(SEOGWIPO_DOWNTOWN));

    expect(savedBeachId(save)).toBeNull();
    expect(result.beachId).toBeNull();
    expect(result.beachName).toBeNull();
    expect(result.beachAssignment).toBe('none');
    expect(result.beachDistanceKm).toBeNull();
  });

  it('사용자가 고른 해변은 그대로 존중한다(자동 배정하지 않는다)', async () => {
    const { service, save } = setup();

    // 좌표는 함덕(id=2) 앞이지만 사용자가 협재(id=1)를 골랐다 → 협재를 유지한다.
    const result = await service.submit(command({ beachId: 1 }));

    expect(savedBeachId(save)).toBe(1);
    expect(result.beachId).toBe(1);
    expect(result.beachName).toBe('협재해수욕장');
    expect(result.beachAssignment).toBe('user');
    expect(result.beachDistanceKm).toBeNull();
  });

  it('비활성 해변에는 자동 배정하지 않는다', async () => {
    const inactiveHamdeok = BEACHES.map((b) => (b.beachId === 2 ? { ...b, isActive: false } : b));
    const { service, save } = setup(inactiveHamdeok);

    const result = await service.submit(command()); // 함덕 앞 좌표

    // 다음 활성 후보(삼양/김녕 등)는 이 후보 목록에 없고, 남은 활성 해변은 모두 반경 밖이다.
    expect(savedBeachId(save)).toBeNull();
    expect(result.beachAssignment).toBe('none');
  });

  it('해변 좌표 조회가 실패해도 제보 접수는 막지 않는다(배정만 포기)', async () => {
    const { service, save } = setup(new Error('DB down'));

    const result = await service.submit(command());

    expect(save).toHaveBeenCalled();
    expect(savedBeachId(save)).toBeNull();
    expect(result.beachAssignment).toBe('none');
  });

  it('AI 판별을 비동기로 트리거한다(기존 동작 유지)', async () => {
    const { service } = setup();

    const result = await service.submit(command());

    expect(result.aiStatus).toBe('pending');
    expect(result.status).toBe('received');
  });
});
