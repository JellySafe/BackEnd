import { JellyfishSpeciesView } from './jellyfish-species';
import { buildSpeciesIndex, matchSpecies, speciesNameKey } from './species-name';

/** 도감 시드(prisma/seed.ts)에서 매칭에 관계된 종만 추린 것. */
function species(overrides: Partial<JellyfishSpeciesView> & { koreanName: string }): JellyfishSpeciesView {
  return {
    id: 1,
    scientificName: null,
    toxicity: null,
    features: null,
    appearanceSeason: null,
    stingSymptom: null,
    imageUrl: null,
    imageSource: null,
    imageSourceUrl: null,
    displayOrder: 1,
    ...overrides,
  };
}

const CATALOG: JellyfishSpeciesView[] = [
  species({ id: 1, koreanName: '두빛보름달해파리', toxicity: 'strong', displayOrder: 1 }),
  species({ id: 2, koreanName: '관해파리류', displayOrder: 2 }),
  species({ id: 7, koreanName: '보름달물해파리', toxicity: 'mild', displayOrder: 7 }),
  species({
    id: 8,
    koreanName: '노무라입깃해파리',
    scientificName: 'Nemopilema nomurai',
    toxicity: 'strong',
    displayOrder: 8,
    imageUrl: 'https://www.nifs.go.kr/portal/cmmn/images/jely/j8.jpg',
    imageSource: '국립수산과학원',
  }),
  species({
    id: 12,
    koreanName: '유령해파리',
    scientificName: 'Cyanea nozakii',
    toxicity: 'strong',
    displayOrder: 12,
    imageUrl: 'https://www.nifs.go.kr/portal/cmmn/images/jely/j12.jpg',
    imageSource: '국립수산과학원',
  }),
];

describe('speciesNameKey (종 표기 정규화)', () => {
  it('접미사 "류" 를 벗긴다 — 주간보고 표기와 도감 표기를 잇는 핵심 규칙', () => {
    expect(speciesNameKey('유령해파리류')).toBe('유령해파리');
    expect(speciesNameKey('유령해파리')).toBe('유령해파리');
  });

  it('도감 국명 자체에 "류" 가 붙은 종도 같은 규칙으로 벗긴다(양방향 대칭)', () => {
    // 관해파리류 는 종정보 페이지의 국명 자체가 '류' 로 끝난다. 한쪽만 벗기면 이 종이 깨진다.
    expect(speciesNameKey('관해파리류')).toBe('관해파리');
  });

  it('PDF 추출 과정에서 끼어든 공백을 제거한다', () => {
    expect(speciesNameKey(' 유령 해파리류 ')).toBe('유령해파리');
    expect(speciesNameKey('노무라입깃 해파리')).toBe('노무라입깃해파리');
  });

  it('"류" 가 없는 이름은 그대로 둔다', () => {
    expect(speciesNameKey('노무라입깃해파리')).toBe('노무라입깃해파리');
  });
});

describe('matchSpecies (출현 기록 → 도감)', () => {
  const index = buildSpeciesIndex(CATALOG);

  it('주간보고의 "유령해파리류" 가 도감의 "유령해파리" 에 매칭된다', () => {
    // 실데이터: 2026-07 현재 제주에 출현 중인 종. 이게 안 붙으면 사진이 안 나온다.
    const matched = matchSpecies(index, '유령해파리류');

    expect(matched?.koreanName).toBe('유령해파리');
    expect(matched?.scientificName).toBe('Cyanea nozakii');
    expect(matched?.toxicity).toBe('strong');
    expect(matched?.imageUrl).toBe('https://www.nifs.go.kr/portal/cmmn/images/jely/j12.jpg');
  });

  it('표기가 같은 종("노무라입깃해파리")도 그대로 매칭된다', () => {
    expect(matchSpecies(index, '노무라입깃해파리')?.id).toBe(8);
  });

  it('도감 국명에 "류" 가 붙은 종은 양쪽 표기 모두로 찾힌다', () => {
    expect(matchSpecies(index, '관해파리류')?.id).toBe(2);
    expect(matchSpecies(index, '관해파리')?.id).toBe(2);
  });

  it('이름이 겹치는 별개 종을 섞지 않는다 — 부분 일치 금지', () => {
    // '보름달물해파리'(약독성) 와 '두빛보름달해파리'(강독성) 는 다른 종이다.
    // 느슨하게 매칭하면 약독성 종에 강독성 설명이 붙는 사고가 난다.
    expect(matchSpecies(index, '보름달물해파리')?.toxicity).toBe('mild');
    expect(matchSpecies(index, '두빛보름달해파리')?.toxicity).toBe('strong');
    expect(matchSpecies(index, '보름달해파리')).toBeNull(); // 어느 쪽으로도 넘겨짚지 않는다
  });

  it('도감에 없는 종은 null 을 돌려준다(예외를 던지지 않는다)', () => {
    expect(matchSpecies(index, '살파류')).toBeNull();
    expect(matchSpecies(index, '')).toBeNull();
  });
});

describe('buildSpeciesIndex', () => {
  it('키가 겹치면 먼저 온 항목(=displayOrder 가 앞선 항목)을 남긴다', () => {
    const index = buildSpeciesIndex([
      species({ id: 2, koreanName: '관해파리류', displayOrder: 2 }),
      species({ id: 99, koreanName: '관해파리', displayOrder: 99 }),
    ]);

    expect(index.size).toBe(1);
    expect(index.get('관해파리')?.id).toBe(2);
  });
});
