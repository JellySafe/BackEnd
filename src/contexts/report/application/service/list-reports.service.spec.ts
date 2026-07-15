import { Page, PageRequest } from '@shared/kernel/pagination';
import { BeachCandidate } from '../../domain/nearest-beach';
import { BeachLocationPort } from '../port/out/beach-location.port';
import { ReportListItem, ReportQueryPort } from '../port/out/report-query.port';
import { ListReportsService } from './list-reports.service';

const BEACHES: BeachCandidate[] = [
  { beachId: 1, name: '협재해수욕장', lat: 33.3941, lng: 126.2396, isActive: true },
  { beachId: 2, name: '함덕해수욕장', lat: 33.5432, lng: 126.6698, isActive: true },
  { beachId: 4, name: '중문색달해수욕장', lat: 33.2447, lng: 126.4103, isActive: true },
];

const PAGE: PageRequest = { page: 1, size: 20 };

function item(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    reportId: 19,
    beachId: null,
    beachName: null,
    beachLat: null,
    beachLng: null,
    lat: 33.2472123, // 서귀포 도심
    lng: 126.5545223,
    nearestBeachId: null,
    nearestBeachName: null,
    nearestBeachDistanceKm: null,
    reportType: 'general',
    status: 'verified',
    aiResult: 'normal',
    aiConfidence: 0.9,
    imageUrl: '/uploads/1784018113485-8afb351da8e4d6a7.png',
    thumbnailUrl: null,
    submittedAt: new Date('2026-07-13T23:35:14.000Z'),
    ...overrides,
  };
}

describe('ListReportsService (ADM-008 목록 + 위치 맥락)', () => {
  function setup(items: ReportListItem[]) {
    const page: Page<ReportListItem> = {
      items,
      total: items.length,
      page: 1,
      size: 20,
      totalPages: 1,
    };
    const list = jest.fn().mockResolvedValue(page);
    const query = { list } as unknown as ReportQueryPort;
    const listBeachLocations = jest.fn().mockResolvedValue(BEACHES);
    const beachLocations: BeachLocationPort = { listBeachLocations };
    return { service: new ListReportsService(query, beachLocations), listBeachLocations };
  }

  it('해변이 배정되지 않은 제보에 최근접 해변과 거리를 채운다', async () => {
    const { service } = setup([item()]);

    const result = await service.list({}, PAGE);
    const row = result.items[0];

    expect(row.beachId).toBeNull();
    expect(row.nearestBeachId).toBe(4);
    expect(row.nearestBeachName).toBe('중문색달해수욕장');
    expect(row.nearestBeachDistanceKm).toBeGreaterThan(13);
    // 좌표와 사진은 그대로 실려야 지도/썸네일을 그릴 수 있다.
    expect(row.lat).toBeCloseTo(33.2472123, 6);
    expect(row.imageUrl).toBe('/uploads/1784018113485-8afb351da8e4d6a7.png');
  });

  it('해변이 배정된 제보는 최근접 필드를 채우지 않는다(해변 좌표를 이미 준다)', async () => {
    const assigned = item({
      beachId: 2,
      beachName: '함덕해수욕장',
      beachLat: 33.5432,
      beachLng: 126.6698,
      lat: 33.5430616,
      lng: 126.6692389,
    });
    const { service, listBeachLocations } = setup([assigned]);

    const row = (await service.list({}, PAGE)).items[0];

    expect(row.nearestBeachId).toBeNull();
    expect(row.nearestBeachName).toBeNull();
    expect(row.beachLat).toBe(33.5432);
    // 채울 대상이 없으면 해변 좌표를 조회하지도 않는다.
    expect(listBeachLocations).not.toHaveBeenCalled();
  });

  it('좌표가 파기된(PRIV-003) 제보는 최근접 계산을 시도하지 않는다', async () => {
    const purged = item({ lat: null, lng: null, imageUrl: null });
    const { service, listBeachLocations } = setup([purged]);

    const row = (await service.list({}, PAGE)).items[0];

    expect(row.nearestBeachId).toBeNull();
    expect(listBeachLocations).not.toHaveBeenCalled();
  });
});
