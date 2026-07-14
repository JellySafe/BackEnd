import { JellyfishSpeciesView } from '../../domain/jellyfish-species';
import {
  CurrentSpeciesFilter,
  OccurrenceSpeciesQueryPort,
  OccurrenceSpeciesRow,
} from '../port/out/occurrence-species-query.port';
import { SpeciesQueryPort } from '../port/out/species-query.port';
import { ListCurrentSpeciesService } from './list-current-species.service';

/** 시드(prisma/seed.ts) 기준 도감 일부. */
const CATALOG: JellyfishSpeciesView[] = [
  {
    id: 8,
    koreanName: '노무라입깃해파리',
    scientificName: 'Nemopilema nomurai',
    toxicity: 'strong',
    features: '대형해파리로 우산의 직경이 150cm, 무게가 100kg 을 넘는다.',
    appearanceSeason: '6월말 제주에서 출현, 8월 중순에는 우리나라 전역에서 출현한다.',
    stingSymptom: '통증과 홍반을 동반한 채찍 모양의 상처',
    imageUrl: 'https://www.nifs.go.kr/portal/cmmn/images/jely/j8.jpg',
    imageSource: '국립수산과학원',
    imageSourceUrl: 'https://www.nifs.go.kr/portal/me/jelyC/actionJelyFishInfo.do',
    displayOrder: 8,
  },
  {
    id: 12,
    koreanName: '유령해파리',
    scientificName: 'Cyanea nozakii',
    toxicity: 'strong',
    features: '몸체는 연한 우유빛이며, 우산의 크기는 30~50cm.',
    appearanceSeason: '7월부터 11월까지 남해안 일대에 분포',
    stingSymptom: '통증',
    imageUrl: 'https://www.nifs.go.kr/portal/cmmn/images/jely/j12.jpg',
    imageSource: '국립수산과학원',
    imageSourceUrl: 'https://www.nifs.go.kr/portal/me/jelyC/actionJelyFishInfo.do',
    displayOrder: 12,
  },
];

function row(overrides: Partial<OccurrenceSpeciesRow> = {}): OccurrenceSpeciesRow {
  return {
    reportedName: '노무라입깃해파리',
    region: '제주시',
    densityLevel: 'high',
    alertLevel: 'caution',
    isToxic: true,
    occurredAt: new Date('2026-07-08T15:00:00.000Z'), // 주간보고 2026-07-09 (KST 자정)
    ...overrides,
  };
}

function setup(rows: OccurrenceSpeciesRow[], catalog: JellyfishSpeciesView[] = CATALOG) {
  const listCurrent = jest.fn<Promise<OccurrenceSpeciesRow[]>, [CurrentSpeciesFilter]>()
    .mockResolvedValue(rows);
  const occurrences: OccurrenceSpeciesQueryPort = { listCurrent };
  const species: SpeciesQueryPort = { list: jest.fn().mockResolvedValue(catalog) };
  return { service: new ListCurrentSpeciesService(occurrences, species), listCurrent };
}

describe('ListCurrentSpeciesService (지금 출현 중인 종)', () => {
  it('주간보고 표기 "유령해파리류" 를 도감 "유령해파리" 에 붙여 사진·학명·독성을 채운다', async () => {
    // 표기 불일치가 실제로 흡수되는지 — 이게 깨지면 지금 제주에 나온 종의 사진이 안 나온다.
    const { service } = setup([row({ reportedName: '유령해파리류', densityLevel: 'low' })]);

    const [current] = await service.list({});

    expect(current.reportedName).toBe('유령해파리류'); // 화면에는 기관 발표 표기를 그대로 쓴다
    expect(current.species?.koreanName).toBe('유령해파리');
    expect(current.species?.scientificName).toBe('Cyanea nozakii');
    expect(current.species?.toxicity).toBe('strong');
    expect(current.species?.imageUrl).toBe('https://www.nifs.go.kr/portal/cmmn/images/jely/j12.jpg');
    expect(current.species?.imageSource).toBe('국립수산과학원'); // 출처는 항상 함께 내려간다
  });

  it('2026-07 제주 실데이터: 노무라입깃해파리·유령해파리류 둘 다 강독성으로 연결된다', async () => {
    const { service } = setup([
      row({ reportedName: '노무라입깃해파리', densityLevel: 'high' }),
      row({ reportedName: '유령해파리류', densityLevel: 'low' }),
    ]);

    const result = await service.list({ region: '제주시' });

    expect(result.map((r) => [r.reportedName, r.species?.toxicity])).toEqual([
      ['노무라입깃해파리', 'strong'], // 고밀도가 먼저
      ['유령해파리류', 'strong'],
    ]);
  });

  it('도감에 없는 종이어도 출현 사실은 그대로 내려간다 (species=null)', async () => {
    const { service } = setup([row({ reportedName: '살파류', isToxic: false })]);

    const [current] = await service.list({});

    expect(current.reportedName).toBe('살파류');
    expect(current.species).toBeNull();
    expect(current.densityLevel).toBe('high'); // 출현 정보는 버리지 않는다
  });

  it('같은 (종, 지역) 이 여러 주에 걸쳐 잡히면 가장 최근 1건으로 접는다', async () => {
    const { service } = setup([
      row({ occurredAt: new Date('2026-07-08T15:00:00.000Z'), densityLevel: 'high' }),
      row({ occurredAt: new Date('2026-07-01T15:00:00.000Z'), densityLevel: 'low' }), // 지난주 보고
    ]);

    const result = await service.list({});

    expect(result).toHaveLength(1);
    expect(result[0].occurredAt).toEqual(new Date('2026-07-08T15:00:00.000Z'));
    expect(result[0].densityLevel).toBe('high');
  });

  it('같은 종이라도 지역이 다르면 따로 보여준다', async () => {
    const { service } = setup([
      row({ region: '제주시', densityLevel: 'high' }),
      row({ region: '서귀포시', densityLevel: 'low' }),
    ]);

    const result = await service.list({});

    expect(result.map((r) => [r.region, r.densityLevel])).toEqual([
      ['제주시', 'high'], // 고밀도 우선
      ['서귀포시', 'low'],
    ]);
  });

  it('기본 조회 창은 14일이다 (주간보고 발행이 밀려도 화면이 비지 않도록)', async () => {
    const { service, listCurrent } = setup([]);

    await service.list({});
    expect(listCurrent).toHaveBeenCalledWith({ region: undefined, withinDays: 14 });

    await service.list({ region: '제주시', withinDays: 7 });
    expect(listCurrent).toHaveBeenCalledWith({ region: '제주시', withinDays: 7 });
  });

  it('출현 기록이 없으면 빈 배열 (예외를 던지지 않는다)', async () => {
    const { service } = setup([]);
    await expect(service.list({})).resolves.toEqual([]);
  });
});
