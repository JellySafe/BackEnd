import { guideSourceHash, localizeGuide } from './guide-translation';

/**
 * 안내 문구 언어 선택.
 *
 * ⚠️ 여기서 지키는 것은 "번역을 보여준다" 가 아니라 **"틀릴 수 있는 번역을 안 보여준다"** 다.
 * 응급대처법은 지침이 바뀌면 원문이 갱신되는데(seed 가 FIRST_AID 를 강제로 덮어쓴다),
 * 그때 옛 번역을 그대로 내보내면 외국인 방문객은 **현행과 반대되는 처치**를 안내받는다.
 * 옛 지침은 식초·알코올을 권했고, 지금은 그게 자포 발사를 촉진한다고 본다.
 */
describe('localizeGuide', () => {
  const source = { title: '해파리 응급대처법', body: '수돗물로 씻지 마세요.' };
  const hash = guideSourceHash(source.title, source.body);

  const en = {
    locale: 'en',
    title: 'Jellyfish first aid',
    body: 'Do not rinse with tap water.',
    sourceHash: hash,
  };

  it('번역이 있으면 그 언어로 준다', () => {
    const result = localizeGuide(source, [en], 'en');

    expect(result.locale).toBe('en');
    expect(result.body).toBe('Do not rinse with tap water.');
  });

  it('한국어 요청이면 원문을 그대로 준다', () => {
    expect(localizeGuide(source, [en], 'ko')).toMatchObject({ locale: 'ko', body: source.body });
  });

  it('그 언어 번역이 없으면 한국어로 떨어진다 — 빈 값을 내보내면 안내가 사라진다', () => {
    const result = localizeGuide(source, [en], 'ja');

    expect(result.locale).toBe('ko');
    expect(result.body).toBe(source.body);
  });

  it('⚠️ 원문이 바뀌면 옛 번역을 버리고 한국어(현행)를 준다', () => {
    // 지침이 개정된 상황. 번역은 아직 옛 문구다.
    const revised = { title: source.title, body: '바닷물로 씻으세요. (개정)' };

    const result = localizeGuide(revised, [en], 'en');

    expect(result.locale).toBe('ko');
    // 읽을 수 있지만 틀릴 수 있는 글보다, 기계번역으로라도 돌려 읽을 수 있는 현행 원문이 낫다.
    expect(result.body).toBe('바닷물로 씻으세요. (개정)');
  });

  it('제목만 바뀌어도 번역을 버린다', () => {
    const revised = { title: '해파리 응급처치 (개정)', body: source.body };

    expect(localizeGuide(revised, [en], 'en').locale).toBe('ko');
  });

  it('제목이 없는 문구도 다룬다', () => {
    const noTitle = { title: null, body: '본문만 있는 안내' };
    const tr = {
      locale: 'en',
      title: null,
      body: 'Body only',
      sourceHash: guideSourceHash(null, noTitle.body),
    };

    expect(localizeGuide(noTitle, [tr], 'en')).toMatchObject({ locale: 'en', body: 'Body only' });
  });
});

describe('guideSourceHash', () => {
  it('같은 원문이면 같은 해시다', () => {
    expect(guideSourceHash('가', '나')).toBe(guideSourceHash('가', '나'));
  });

  it('⚠️ 제목과 본문의 경계가 흔들려도 다른 해시다', () => {
    // 구분자가 없으면 ('AB','C') 와 ('A','BC') 가 같은 해시가 되어, 경계만 바뀐 개정을
    // "안 바뀐 것" 으로 보게 된다.
    expect(guideSourceHash('AB', 'C')).not.toBe(guideSourceHash('A', 'BC'));
  });

  it('제목 없음과 빈 제목을 같게 본다 — DB 에서 NULL 과 빈 문자열이 오간다', () => {
    expect(guideSourceHash(null, '본문')).toBe(guideSourceHash('', '본문'));
  });
});
