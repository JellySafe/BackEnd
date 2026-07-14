import { MARINE_REGIONS, resolveMarineRegion } from './marine-forecast-region';

/** seed.ts 의 해변 12곳 (이름·좌표 그대로). */
const BEACHES: Array<[string, number, number]> = [
  ['협재해수욕장', 33.3941, 126.2396],
  ['함덕해수욕장', 33.5432, 126.6698],
  ['이호테우해수욕장', 33.4986, 126.4525],
  ['중문색달해수욕장', 33.2447, 126.4103],
  ['표선해수욕장', 33.3262, 126.8339],
  ['곽지과물해수욕장', 33.4514, 126.305],
  ['금능으뜸원해수욕장', 33.3889, 126.2372],
  ['삼양검은모래해수욕장', 33.5183, 126.5972],
  ['김녕성세기해수욕장', 33.5588, 126.7566],
  ['월정리해수욕장', 33.5563, 126.7955],
  ['화순금모래해수욕장', 33.2419, 126.3389],
  ['신양섭지해수욕장', 33.4351, 126.913],
];

const beach = (name: string) => {
  const found = BEACHES.find(([n]) => n === name)!;
  return { name: found[0], lat: found[1], lng: found[2] };
};

describe('resolveMarineRegion — 해변 12곳 배정', () => {
  it('북쪽에 열린 해변 6곳은 제주도북부앞바다', () => {
    for (const name of [
      '함덕해수욕장',
      '이호테우해수욕장',
      '삼양검은모래해수욕장',
      '김녕성세기해수욕장',
      '월정리해수욕장',
      '곽지과물해수욕장',
    ]) {
      expect(resolveMarineRegion(beach(name))).toEqual({
        region: MARINE_REGIONS.JEJU_NORTH,
        fromTable: true,
      });
    }
  });

  it('한림 서쪽 해변(협재·금능)은 제주도서부앞바다', () => {
    expect(resolveMarineRegion(beach('협재해수욕장')).region).toBe(MARINE_REGIONS.JEJU_WEST);
    expect(resolveMarineRegion(beach('금능으뜸원해수욕장')).region).toBe(MARINE_REGIONS.JEJU_WEST);
  });

  it('서귀포 남해안 해변(중문·화순·표선)은 제주도남부앞바다', () => {
    expect(resolveMarineRegion(beach('중문색달해수욕장')).region).toBe(MARINE_REGIONS.JEJU_SOUTH);
    expect(resolveMarineRegion(beach('화순금모래해수욕장')).region).toBe(MARINE_REGIONS.JEJU_SOUTH);
    expect(resolveMarineRegion(beach('표선해수욕장')).region).toBe(MARINE_REGIONS.JEJU_SOUTH);
  });

  it('성산 동쪽 해변(신양섭지)은 제주도동부앞바다', () => {
    expect(resolveMarineRegion(beach('신양섭지해수욕장')).region).toBe(MARINE_REGIONS.JEJU_EAST);
  });

  it('12곳이 4개 구역에 모두 배정되고, 표에서 나온 값임을 표시한다', () => {
    const regions = BEACHES.map(([name, lat, lng]) => resolveMarineRegion({ name, lat, lng }));
    expect(regions.every((r) => r.fromTable)).toBe(true);
    expect(new Set(regions.map((r) => r.region)).size).toBe(4);
  });
});

describe('resolveMarineRegion — 폴백 (표에 없는 신규 해변)', () => {
  it('섬 중심 기준 방위각으로 4분면 배정하고, 표에서 온 값이 아님을 알린다', () => {
    // 우도 동쪽 어딘가 (표에 없는 이름)
    const east = resolveMarineRegion({ name: '새로운해변', lat: 33.5, lng: 126.95 });
    expect(east).toEqual({ region: MARINE_REGIONS.JEJU_EAST, fromTable: false });

    // 대정 남서쪽
    const south = resolveMarineRegion({ name: '이름없는해변', lat: 33.2, lng: 126.5 });
    expect(south).toEqual({ region: MARINE_REGIONS.JEJU_SOUTH, fromTable: false });
  });

  it('좌표가 없으면 광역(제주도앞바다)으로 떨어진다 — 조용히 틀린 구역을 고르지 않는다', () => {
    expect(resolveMarineRegion({ name: '좌표없음', lat: null, lng: null })).toEqual({
      region: MARINE_REGIONS.JEJU_WIDE,
      fromTable: false,
    });
  });
});
