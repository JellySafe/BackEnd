import {
  DEFAULT_LOCALE,
  Locale,
  SUPPORTED_LOCALES,
  isLocale,
  parseAcceptLanguage,
  parseLangParam,
  resolveLocale,
  text,
} from './locale';

/**
 * 표시 언어 결정 (i18n).
 *
 * 이 층이 틀리면 **한국인에게 영어가 나가거나 외국인에게 한국어가 나간다.** 둘 다 조용히
 * 일어나고, 안전 정보라 그 비용이 크다. 그래서 "무엇을 고르는가" 만이 아니라
 * **"애매하면 무엇으로 되돌아가는가"** 를 함께 고정한다.
 */
describe('표시 언어', () => {
  describe('지원 언어', () => {
    it('제주 방문객 구성에 맞춰 넷을 지원한다', () => {
      expect(SUPPORTED_LOCALES).toEqual(['ko', 'en', 'zh', 'ja']);
    });

    it('기본은 한국어다 — 운영 주체와 대다수 이용자의 언어다', () => {
      expect(DEFAULT_LOCALE).toBe('ko');
    });

    it.each(['ko', 'en', 'zh', 'ja'])('%s 를 언어로 인정한다', (value) => {
      expect(isLocale(value)).toBe(true);
    });

    it.each(['KO', 'fr', '', 'ko-KR', null, 42])('%p 는 언어가 아니다', (value) => {
      expect(isLocale(value)).toBe(false);
    });
  });

  describe('문구 고르기', () => {
    const catalog = { ko: '위험', en: 'Danger', zh: '危险', ja: '危険' };

    it.each([
      ['ko', '위험'],
      ['en', 'Danger'],
      ['zh', '危险'],
      ['ja', '危険'],
    ])('%s → %s', (locale, expected) => {
      expect(text(catalog, locale as Locale)).toBe(expected);
    });

    it('번역이 비어 있으면 한국어로 되돌린다 — 빈 문자열이 나가면 화면에서 정보가 사라진다', () => {
      const partial = { ko: '위험', en: '', zh: '危险', ja: '危険' };
      expect(text(partial, 'en')).toBe('위험');
    });
  });

  describe('?lang= 파라미터', () => {
    it('지원 언어를 그대로 쓴다', () => {
      expect(parseLangParam('en')).toBe('en');
    });

    it('대문자·공백을 다듬는다', () => {
      expect(parseLangParam('  EN  ')).toBe('en');
    });

    it('지역 태그가 붙어도 받아들인다', () => {
      expect(parseLangParam('zh-CN')).toBe('zh');
    });

    it.each(['fr', '', 'jellyfish', null, undefined, 42, ['en']])(
      '%p 는 무시한다 (null)',
      (value) => {
        expect(parseLangParam(value)).toBeNull();
      },
    );
  });

  describe('Accept-Language 헤더', () => {
    it('가장 앞의 지원 언어를 고른다', () => {
      expect(parseAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    });

    it('q 값이 높은 것을 먼저 본다 — 순서가 아니라 선호도가 기준이다', () => {
      expect(parseAcceptLanguage('en;q=0.3,ja;q=0.9')).toBe('ja');
    });

    it('q 가 같으면 적힌 순서를 지킨다 — 브라우저가 선호 순으로 보낸다', () => {
      expect(parseAcceptLanguage('ja,en')).toBe('ja');
    });

    it('지원하지 않는 언어는 건너뛰고 다음을 본다', () => {
      expect(parseAcceptLanguage('fr-FR,de;q=0.8,en;q=0.5')).toBe('en');
    });

    it('지역 태그를 앞부분으로 맞춘다 — en-AU 가 그냥 빠지면 안 된다', () => {
      expect(parseAcceptLanguage('en-AU')).toBe('en');
      expect(parseAcceptLanguage('zh-Hans-CN')).toBe('zh');
    });

    it('q=0 은 "원하지 않는다" 이므로 고르지 않는다', () => {
      expect(parseAcceptLanguage('en;q=0,ja;q=0.5')).toBe('ja');
    });

    it('* 는 기본값에 맡긴다 — 여기서 영어를 고르면 한국인에게 영어가 나간다', () => {
      expect(parseAcceptLanguage('*')).toBeNull();
    });

    it('q 형식이 깨진 항목만 버리고 나머지는 본다 — 요청 전체를 거부할 일이 아니다', () => {
      expect(parseAcceptLanguage('en;q=abc,ja;q=0.5')).toBe('ja');
    });

    it.each(['', 'fr,de', undefined, null, 42])('%p 면 고르지 못한다 (null)', (value) => {
      expect(parseAcceptLanguage(value)).toBeNull();
    });
  });

  describe('요청의 언어 확정', () => {
    it('?lang= 이 헤더보다 우선한다 — 앱에서 고른 값이 기기 설정에 눌리면 안 된다', () => {
      // 한국에 오래 산 외국인은 기기가 한국어인 채로 영어를 고를 수 있다.
      expect(resolveLocale('en', 'ko-KR,ko;q=0.9')).toBe('en');
    });

    it('?lang= 이 없으면 헤더를 본다', () => {
      expect(resolveLocale(undefined, 'ja-JP')).toBe('ja');
    });

    it('?lang= 이 지원하지 않는 값이면 헤더로 넘어간다 — 요청을 실패시키지 않는다', () => {
      expect(resolveLocale('fr', 'en-US')).toBe('en');
    });

    it('둘 다 없으면 한국어다', () => {
      expect(resolveLocale(undefined, undefined)).toBe('ko');
    });

    it('둘 다 알 수 없으면 한국어다 — 애매하면 운영 주체의 언어로 되돌아간다', () => {
      expect(resolveLocale('kr', 'fr,de')).toBe('ko');
    });
  });
});
