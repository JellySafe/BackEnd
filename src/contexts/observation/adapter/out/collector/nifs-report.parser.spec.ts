import {
  JejuRegion,
  normalize,
  parseJejuAdvisory,
  parseJejuRatioRow,
  parseNifsWeeklyReport,
  parseReportPeriod,
  parseSpeciesBlocks,
  resolveAlertLevel,
} from './nifs-report.parser';

/**
 * 픽스처: **실제 NIFS 주간보고 PDF**(2026-07-09, srcode=20260709135753010IDT)를
 * jellyDetail → item2[0].board_file 로 내려받아 pdf-parse 로 추출한 텍스트 원문 그대로다.
 * (탭/줄바꿈/페이지 구분자 `-- N of 9 --` 포함. 네트워크 없이 파서만 검증한다.)
 *
 * 검증 포인트:
 *  - 종별 블록의 시군구 단위 고/저밀도 목록에서 제주만 추출
 *  - 노무라 저밀도 목록이 **페이지 경계를 넘어**(2페이지 첫 줄 `- 제주 서귀포시`) 이어지는 것 처리
 *  - 조치사항의 제주 특보(예비주의보) → alert_level 매핑
 *  - 붙임3 제주 행(77.8 / - / 11.1) 분해
 */
const REAL_REPORT_TEXT = `- \t1 \t-
- \t어업인 \t해파리모니터링요원의 \t협조로 \t취합/분석한 \t자료임 \t-
◇ \t대량출현해파리
- \t노무라입깃해파리(11%→12%): \t전남, \t부산, \t제주 \t고밀도 \t/ \t충남, \t경남, \t울산, \t경북 \t출현
- \t보름달물해파리(32%→32%): \t충남, \t전남, \t경남, \t부산 \t고밀도 \t/
인천, \t경기, \t전북, \t울산, \t강원 \t저밀도 \t출현
◇ \t독성해파리
- \t두빛보름달해파리(4%→5%): \t강원 \t고밀도 \t/ \t경북 \t저밀도 \t출현
- \t야광원양해파리(1%미만): \t경남 \t고밀도 \t출현
- \t유령해파리류(3%→3%): \t부산, \t제주 \t고밀도 \t/ \t전남, \t경남, \t울산, \t경북 \t저밀도 \t출현
- \t커튼원양해파리(4%→3%): \t경남 \t고밀도 \t/ \t전남, \t강원 \t저밀도 \t출현
■ \t해파리 \t주간 \t동향 \t(2 0 2 6 .0 7 .0 3 .~ 0 7 .0 9 .)
종류 \t출현해역 \t출현율 \t독성 \t비고
노무라입깃해파리
◎서해, \t남해, \t동해, \t제주 \t출현
○고밀도 \t출현 \t해역
- \t전남 \t영광군
- \t전남 \t신안군
- \t부산광역시 \t영도구
- \t경북 \t포항시
- \t제주 \t제주시
○저밀도 \t출현 \t해역
- \t충남 \t태안군
- \t전남 \t고흥군
- \t경남 \t남해군
- \t경남 \t통영시
- \t경남 \t거제시
- \t경남 \t창원시
- \t부산광역시 \t해운대구
- \t부산광역시 \t기장군
- \t울산광역시 \t울주군
11.9%(7/9)
↑
11.4%(7/2)
↑
5.1%(6/25)
강독성
※ \t출현율은 \t이번주
어업인모니터링요원
319명 \t중
해파리를 \t관찰한
사람 \t수를
백분율화한 \t값으로
대량출현의 \t판단
근거로 \t이용될 \t수
없음.
해파리 \t모니터링 \t주간보고
2026.07.03.~07.09.
담당
부서 기후변화연구과
문서번호 \t2026.07.09. \t* \t26 \t- \t10호
담 \t당 \t자
◾과 \t장: \t한인성
◾연구관: \t윤석현, \t연구사: \t김경연
◾연구원: \t최서열, \t오선영, \t김예진, \t최정미,
홍가희, \t정유진, \t이준혁
◾☎ \t051) \t720-2223
◾☎ \t051) \t720-2236

-- 1 of 9 --

- \t2 \t-
- \t경북 \t경주시
- \t강원 \t삼척시
- \t제주 \t서귀포시
보름달물해파리
◎서해, \t남해, \t동해 \t출현
○고밀도 \t출현 \t해역
- \t충남 \t태안군
- \t전남 \t완도군
- \t전남 \t강진군
- \t전남 \t장흥군
- \t전남 \t보성군
- \t전남 \t고흥군
- \t경남 \t남해군
- \t경남 \t고성군
- \t경남 \t통영시
- \t경남 \t거제시
- \t경남 \t창원시
- \t부산광역시 \t영도구
○저밀도 \t출현 \t해역
- \t인천광역시 \t강화군
- \t경기 \t안산시
- \t경기 \t화성시
- \t충남 \t당진시
- \t충남 \t서천군
- \t전북 \t군산시
- \t전북 \t부안군
- \t전남 \t목포시
- \t전남 \t해남군
- \t전남 \t여수시
- \t부산광역시 \t강서구
- \t부산광역시 \t수영구
- \t부산광역시 \t해운대구
- \t울산광역시 \t북구
- \t강원 \t동해시
- \t강원 \t양양군
- \t강원 \t속초시
32.3%(7/9)
↑
31.5%(7/2)
↑
35.6%(6/25)
약독성

-- 2 of 9 --

- \t3 \t-
두빛보름달해파리
◎동해 \t출현
○고밀도 \t출현 \t해역
- \t강원 \t동해시
○저밀도 \t출현 \t해역
- \t경북 \t포항시
- \t강원 \t강릉시
- \t강원 \t양양군
- \t강원 \t속초시
- \t강원 \t고성군
5.0%(7/9)
↑
4.0%(7/2)
↑
3.4%(6/25)
강독성
야광원양해파리
◎남해 \t출현
○고밀도 \t출현 \t해역
- \t경남 \t창원시
0.3%(7/9) \t강독성
유령해파리류
◎서해, \t남해, \t동해, \t제주 \t출현
○고밀도 \t출현 \t해역
- \t부산광역시 \t영도구
- \t부산광역시 \t수영구
- \t부산광역시 \t기장군
- \t제주 \t제주시
○저밀도 \t출현 \t해역
- \t전남 \t영광군
- \t전남 \t고흥군
- \t경남 \t창원시
- \t울산광역시 \t울주군
- \t경북 \t포항시
3.4%(7/9)
↑
2.8%(7/2)
↑
2.7%(6/25)
강독성
커튼원양해파리
◎서해, \t남해, \t동해 \t출현
○고밀도 \t출현 \t해역
- \t경남 \t거제시
- \t경남 \t창원시
○저밀도 \t출현 \t해역
- \t전남 \t목포시
- \t강원 \t양양군
- \t강원 \t속초시
2.5%(7/9)
↑
4.0%(7/2)
↑
4.1%(6/25)
강독성

-- 3 of 9 --

- \t4 \t-
기수식용해파리
◎서해 \t출현
○저밀도 \t출현 \t해역
- \t전남 \t영광군
0.3%(7/9)
↑
0.6%(7/2)
↑
0.3%(6/25)
약독성
살파류(척삭동물)
- \t해파리 \t아님
송곳살파
큰살파
◎서해, \t남해 \t출현
○저밀도 \t출현 \t해역
- \t충남 \t서천군
- \t경남 \t남해군
- \t경남 \t거제시
0.9%(7/9)
↑
0.3%(7/2)
↑
2.1%(6/25)
무해성

-- 4 of 9 --

- \t5 \t-
□ \t해파리 \t웹(web) \t신고 \t(2026.07.02.~07.08.) \t총 \t: \t52건
(지자체 \t웹신고 \t1건 \t포함)
○노무라입깃해파리: \t18건
- \t경남 \t3건
- \t제주 \t15건
○보름달물해파리: \t15건
- \t경기 \t1건
- \t전남 \t4건
- \t경남 \t10건
○두빛보름달해파리: \t2건
- \t강원 \t2건
○유령해파리류: \t1건
- \t제주 \t1건
○커튼원양해파리: \t8건
- \t경남 \t8건
○빗해파리류: \t1건
- \t제주 \t1건
○푸른우산관해파리: \t1건
- \t제주 \t1건
○알수없음: \t2건
- \t제주 \t2건
○출현없음: \t4건
- \t경남 \t4건
□ \t조치사항
○ \t해파리 \t특보 \t발표 \t해역
- \t경남(6.22) \t주의보 \t상향
- \t전북(6.8) \t예비주의보
- \t전남·제주(6.22) \t예비주의보 \t신규 \t발표
○ \t제주 \t근해 \t및 \t남해 \t연근해 \t해파리 \t정밀조사 \t조사 \t수행 \t중(7.1~10)
□ \t금후전망
○ \t(보름달물해파리) \t전남·경남 \t연안 \t일부 \t해역에 \t당분간 \t고밀도 \t출현 \t전망
○ \t(노무라입깃해파리) \t제주·남해 \t연안에 \t지속 \t유입되어 \t고밀도 \t출현 \t전망

-- 5 of 9 --

- \t6 \t-
【붙임 \t1. \t금주 \t해파리 \t분포도】
그림. \t2026년 \t7월 \t3일 \t~ \t7월 \t9일 \t한국 \t연안 \t해역 \t해파리 \t분포도.

-- 6 of 9 --

- \t7 \t-
【붙임 \t2. \t해파리 \t출현율의 \t연별 \t변동】
<국립수산과학원 \t노무라입깃해파리 \t출현율 \t연별 \t변동>
<국립수산과학원 \t보름달물해파리 \t출현율 \t연별 \t변동>

-- 7 of 9 --

- \t8 \t-
【붙임 \t3. \t각 \t지역별 \t해파리 \t출현율(%)】
노무라입깃해파리 \t보름달물해파리 \t기타 \t해파리
인천 \t- \t5.3 \t-
경기 \t- \t27.3 \t-
충남 \t4.3 \t26.1 \t-
전북 \t- \t26.7 \t-
전남 \t12.2 \t59.2 \t8.2
경남 \t9.1 \t50.0 \t8.0
부산 \t33.3 \t38.9 \t27.8
울산 \t20.0 \t20.0 \t10.0
경북 \t21.2 \t- \t9.1
강원 \t2.3 \t15.9 \t36.4
제주 \t77.8 \t- \t11.1
※모니터링 \t요원 \t소속 \t지역과 \t조업지역이 \t다를 \t수 \t있음.
(지역별 \t응답인원 \t중 \t해파리종류별 \t발견자÷지역별 \t응답인원)×100
=지역별 \t해파리종류별 \t출현율
※ \t해파리 \t발견자가 \t두 \t가지 \t이상의 \t종을 \t발견 \t시 \t각각의 \t해파리 \t출현율에 \t반영됨.

-- 8 of 9 --

- \t9 \t-
【붙임 \t4. \t주요 \t해파리 \t분포 \t주간변동】
○노무라입깃해파리
6월 \t25일 \t7월 \t2일 \t7월 \t9일
○보름달물해파리
6월 \t25일 \t7월 \t2일 \t7월 \t9일
○기타해파리
6월 \t25일 \t7월 \t2일 \t7월 \t9일

-- 9 of 9 --

`;

const CTX = { srcode: '20260709135753010IDT', fallbackDate: new Date(2026, 6, 9) };

describe('NIFS 주간보고 파서 — 실제 PDF 텍스트 (2026-07-09)', () => {
  const readings = parseNifsWeeklyReport(REAL_REPORT_TEXT, CTX);
  const find = (species: string, region: JejuRegion) =>
    readings.find((r) => r.species === species && r.region === region);

  it('제주(제주시/서귀포시) 출현만 3건 생성한다', () => {
    expect(readings).toHaveLength(3);
    expect(readings.map((r) => `${r.species}/${r.region}`).sort()).toEqual(
      ['노무라입깃해파리/서귀포시', '노무라입깃해파리/제주시', '유령해파리류/제주시'].sort(),
    );
  });

  it('노무라입깃해파리 / 제주시 = 고밀도·강독성·caution', () => {
    const r = find('노무라입깃해파리', '제주시');
    expect(r).toBeDefined();
    expect(r?.densityLevel).toBe('high');
    expect(r?.isToxic).toBe(true);
    // 제주 예비주의보(=attention) + 고밀도(+1) → caution → NEARBY_ALERT 에 잡힌다.
    expect(r?.alertLevel).toBe('caution');
  });

  it('노무라입깃해파리 / 서귀포시 = 저밀도(페이지 경계를 넘어온 항목)·attention', () => {
    const r = find('노무라입깃해파리', '서귀포시');
    expect(r).toBeDefined();
    expect(r?.densityLevel).toBe('low');
    expect(r?.isToxic).toBe(true);
    // 예비주의보 발효 중이므로 저밀도라도 attention → NEARBY_ALERT 에 계상.
    expect(r?.alertLevel).toBe('attention');
  });

  it('유령해파리류 / 제주시 = 고밀도·강독성·caution', () => {
    const r = find('유령해파리류', '제주시');
    expect(r).toBeDefined();
    expect(r?.densityLevel).toBe('high');
    expect(r?.isToxic).toBe(true);
    expect(r?.alertLevel).toBe('caution');
  });

  it('제주에 출현하지 않은 종(보름달물해파리·커튼원양해파리 등)은 레코드를 만들지 않는다', () => {
    expect(readings.some((r) => r.species === '보름달물해파리')).toBe(false);
    expect(readings.some((r) => r.species === '커튼원양해파리')).toBe(false);
    expect(readings.some((r) => r.species === '두빛보름달해파리')).toBe(false);
  });

  it('occurred_at 은 보고 주간 종료일(2026-07-09)', () => {
    for (const r of readings) {
      expect(r.occurredAt.getFullYear()).toBe(2026);
      expect(r.occurredAt.getMonth()).toBe(6); // 0-based → 7월
      expect(r.occurredAt.getDate()).toBe(9);
    }
  });

  it('external_id 는 srcode-종-지역이며 컬럼 길이(100자) 안에 들어간다', () => {
    const r = find('노무라입깃해파리', '제주시');
    expect(r?.externalId).toBe('20260709135753010IDT-노무라입깃해파리-제주시');
    for (const x of readings) expect((x.externalId ?? '').length).toBeLessThanOrEqual(100);
  });

  it('description 은 제주 출현율·특보·금후전망을 담고 500자를 넘지 않는다', () => {
    const r = find('노무라입깃해파리', '제주시');
    expect(r?.description).toContain('제주 출현율 77.8%'); // 붙임3
    expect(r?.description).toContain('제주 특보 예비주의보'); // 조치사항
    expect(r?.description).toContain('지속 유입되어 고밀도 출현 전망'); // 금후전망
    // 쪽번호/페이지 구분자 같은 PDF 잡음이 섞이지 않아야 한다.
    expect(r?.description).not.toContain('of 9');
    for (const x of readings) expect((x.description ?? '').length).toBeLessThanOrEqual(500);
  });

  it('좌표는 주간보고에 없으므로 null', () => {
    for (const r of readings) {
      expect(r.lat).toBeNull();
      expect(r.lng).toBeNull();
    }
  });
});

describe('구획별 파서', () => {
  const text = normalize(REAL_REPORT_TEXT);

  it('종별 블록: 표에 실린 종만(요약/웹신고 문단의 종명은 제외) 잡는다', () => {
    const blocks = parseSpeciesBlocks(text);
    expect(blocks.map((b) => b.species)).toEqual([
      '노무라입깃해파리',
      '보름달물해파리',
      '두빛보름달해파리',
      '야광원양해파리',
      '유령해파리류',
      '커튼원양해파리',
      '기수식용해파리',
    ]);
  });

  it('노무라 블록: 고밀도=제주시, 저밀도=서귀포시, 출현율 11.9%, 강독성', () => {
    const nomura = parseSpeciesBlocks(text)[0];
    expect(nomura.highRegions).toEqual(['제주시']);
    expect(nomura.lowRegions).toEqual(['서귀포시']);
    expect(nomura.weeklyRatio).toBe(11.9);
    expect(nomura.weeklyRatioText).toBe('11.9%(7/9)');
    expect(nomura.toxicity).toBe('강독성');
    expect(nomura.isToxic).toBe(true);
  });

  it('제주 특보: 경남 "주의보"나 "○ 제주 근해 정밀조사" 문장에 오염되지 않고 예비주의보', () => {
    expect(parseJejuAdvisory(text)).toBe('예비주의보');
  });

  it('붙임3 제주 행: 노무라 77.8 / 보름달 없음(-) / 기타 11.1', () => {
    expect(parseJejuRatioRow(text)).toEqual({ nomura: 77.8, moon: null, etc: 11.1 });
  });

  it('보고 기간: 2026.07.03.~07.09. (종료일 채택)', () => {
    const period = parseReportPeriod(text);
    expect(period?.label).toBe('2026.07.03.~07.09.');
    expect(period?.end).toEqual(new Date(2026, 6, 9));
  });
});

describe('alert_level 매핑 (특보 단계 + 밀도)', () => {
  it('특보 단계를 사다리에 얹고 고밀도면 한 칸 올린다', () => {
    expect(resolveAlertLevel(null, 'low')).toBe('none');
    expect(resolveAlertLevel(null, 'high')).toBe('attention');
    expect(resolveAlertLevel('예비주의보', 'low')).toBe('attention');
    expect(resolveAlertLevel('예비주의보', 'high')).toBe('caution');
    expect(resolveAlertLevel('주의보', 'low')).toBe('caution');
    expect(resolveAlertLevel('주의보', 'high')).toBe('warning');
    expect(resolveAlertLevel('경보', 'low')).toBe('warning');
    expect(resolveAlertLevel('경보', 'high')).toBe('warning'); // 상한
  });
});

describe('견고성', () => {
  it('빈 텍스트 / 무관한 텍스트는 예외 없이 빈 배열', () => {
    expect(parseNifsWeeklyReport('', CTX)).toEqual([]);
    expect(parseNifsWeeklyReport('   \n\t  ', CTX)).toEqual([]);
    expect(parseNifsWeeklyReport('전혀 다른 문서입니다.', CTX)).toEqual([]);
  });

  it('종 블록은 있으나 제주 항목이 없으면 빈 배열', () => {
    const noJeju = [
      '보름달물해파리',
      '◎서해 출현',
      '○고밀도 출현 해역',
      '- 충남 태안군',
      '32.3%(7/9) 약독성',
    ].join('\n');
    expect(parseNifsWeeklyReport(noJeju, CTX)).toEqual([]);
  });

  it('보고 기간이 없으면 occurred_at 은 폴백 날짜(inpt_date)', () => {
    const noPeriod = ['유령해파리류', '◎제주 출현', '○고밀도 출현 해역', '- 제주 제주시', '3.4%(7/9) 강독성'].join(
      '\n',
    );
    const [r] = parseNifsWeeklyReport(noPeriod, CTX);
    expect(r.occurredAt).toEqual(CTX.fallbackDate);
  });

  it('출현율이 불릿에 붙어 나오는 추출기(공백 없는 변형)도 파싱한다', () => {
    // 다른 PDF 추출기는 `- 제주 제주시0.3%(7/9)강독성` 처럼 붙여서 뱉는다.
    const glued =
      '야광원양해파리◎남해, 제주 출현 ○고밀도 출현 해역   - 경남 창원시   - 제주 제주시0.3%(7/9)강독성';
    const [r] = parseNifsWeeklyReport(glued, CTX);
    expect(r.region).toBe('제주시');
    expect(r.densityLevel).toBe('high');
    expect(r.isToxic).toBe(true);
  });

  it('독성 등급을 못 읽으면 is_toxic 은 null(임의 단정 금지)', () => {
    const noTox = ['유령해파리류', '◎제주 출현', '○고밀도 출현 해역', '- 제주 제주시'].join('\n');
    const [r] = parseNifsWeeklyReport(noTox, CTX);
    expect(r.isToxic).toBeNull();
  });
});
