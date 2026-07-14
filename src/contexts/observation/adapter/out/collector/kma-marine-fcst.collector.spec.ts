import {
  __test__,
  MarineFcstRow,
} from './kma-marine-fcst.collector';

const {
  parseMarineForecast,
  latestByTarget,
  isExpired,
  compassToDegrees,
  circularMeanDegrees,
  midpoint,
  parseKstStamp,
  issuanceWindow,
  toReading,
} = __test__;

/**
 * 픽스처는 **실제 응답 그대로**다 (2026-07-14 실호출, reg=12B10302 제주도북부앞바다).
 * 한 응답에 발표(TM_FC) 3회분이 섞여 오는 것, 각 행이 ',=' 로 끝나는 것, 값이 범위로 오는 것
 * — 전부 실물이다.
 */
const REAL_RESPONSE = `#START7777
# REG_ID TM_FC        TM_EF        MOD NE STN C MAN_ID       MAN_FC     W1 T W2 S1 S2  WH1  WH2 SKY  PREP WF
12B10302,202607131700,202607131200,A02,0,184,2,khj,고희종,SE,1,S,8,13,1.0,2.5,DB03,1,구름많고 한때 비,=
12B10302,202607131700,202607140000,A02,1,184,2,khj,고희종,S,1,SW,8,13,1.0,2.5,DB04,1,흐리고 가끔 비,=
12B10302,202607140500,202607140000,A02,0,184,2,*,고성경,S,1,SW,8,13,1.0,2.5,DB04,1,흐리고 가끔 비,=
12B10302,202607140500,202607141200,A02,1,184,2,*,고성경,S,1,SW,8,13,1.0,2.5,DB04,1,흐리고 한때 비,=
12B10302,202607141100,202607141200,A02,0,184,2,khj,고희종,S,1,SW,8,13,1.0,2.5,DB04,1,흐리고 한때 비,=
12B10302,202607141100,202607150000,A02,1,184,2,khj,고희종,SW,1,W,8,13,1.0,2.5,DB04,1,흐리고 가끔 비,=
12B10302,202607141100,202607151200,A02,2,184,2,khj,고희종,SW,1,W,8,12,1.0,2.0,DB04,1,흐리고 한때 비,=
12B10302,202607141100,202607160000,A02,3,184,2,khj,고희종,SW,1,W,7,11,0.5,1.5,DB04,1,흐리고 한때 비,=
#7777END
`;

describe('parseMarineForecast — 실제 응답 파싱', () => {
  const rows = parseMarineForecast(REAL_RESPONSE);

  it('주석(#)·종료 마커를 걸러내고 데이터 행만 읽는다', () => {
    expect(rows).toHaveLength(8);
  });

  it('TM_FC/TM_EF 를 KST 로 해석해 UTC 인스턴트로 바꾼다', () => {
    // 202607141100 KST = 2026-07-14T02:00:00Z
    expect(rows[4].baseAt.toISOString()).toBe('2026-07-14T02:00:00.000Z');
    // 202607141200 KST = 2026-07-14T03:00:00Z
    expect(rows[4].targetAt.toISOString()).toBe('2026-07-14T03:00:00.000Z');
  });

  it('파고·풍속은 범위(WH1~WH2, S1~S2)의 중앙값을 대표값으로 쓴다', () => {
    // 파고 1.0~2.5 → 1.75 / 풍속 8~13 → 10.5
    expect(rows[4].waveHeight).toBeCloseTo(1.75);
    expect(rows[4].windSpeed).toBeCloseTo(10.5);
  });

  it('풍향은 16방위(W1·W2)를 도로 바꿔 원형 평균한다', () => {
    // S(180) ~ SW(225) → 202.5 → 정수 반올림 202
    // (부동소수점상 202.49999… 라 202 로 떨어진다. 유입 판정 허용각이 ±60° 라 1° 차는 무해하다.)
    expect(rows[4].windDirection).toBe(202);
    // SW(225) ~ W(270) → 247.5 → 247
    expect(rows[5].windDirection).toBe(247);
  });

  it('하늘상태는 원문 코드 그대로 저장한다(DB03/DB04)', () => {
    expect(rows[0].skyCode).toBe('DB03');
    expect(rows[1].skyCode).toBe('DB04');
  });

  it('예보문(WF)에 쉼표가 섞여도 앞쪽 수치 컬럼은 흔들리지 않는다', () => {
    const withComma = parseMarineForecast(
      '12B10302,202607141100,202607150000,A02,1,184,2,khj,고희종,SW,1,W,8,13,1.0,2.5,DB04,1,흐리고 한때 비, 곳에 따라 소나기,=',
    );
    expect(withComma).toHaveLength(1);
    expect(withComma[0].waveHeight).toBeCloseTo(1.75);
    expect(withComma[0].skyCode).toBe('DB04');
  });

  it('형식이 어긋난 응답(빈 문자열/HTML/짧은 행)에도 예외 없이 빈 배열을 준다', () => {
    expect(parseMarineForecast('')).toEqual([]);
    expect(parseMarineForecast('<html><body>error</body></html>')).toEqual([]);
    expect(parseMarineForecast('12B10302,202607141100')).toEqual([]);
    expect(parseMarineForecast('# 주석만 있다')).toEqual([]);
  });

  it('결측 센티넬(-9)은 null 로 바꾼다(파고 -9m 를 저장하지 않는다)', () => {
    const missing = parseMarineForecast(
      '12B10302,202607141100,202607150000,A02,1,184,2,khj,고희종,-,1,-,-9,-9,-9,-9,-,1,-,=',
    );
    expect(missing[0].waveHeight).toBeNull();
    expect(missing[0].windSpeed).toBeNull();
    expect(missing[0].windDirection).toBeNull();
    expect(missing[0].skyCode).toBeNull();
  });
});

describe('latestByTarget — 같은 대상 시각은 가장 최신 발표만', () => {
  it('한 응답에 섞여 온 옛 발표가 최신 발표를 덮어쓰지 않는다', () => {
    const rows = parseMarineForecast(REAL_RESPONSE);
    const latest = latestByTarget(rows);

    // 202607141200(대상)은 05시 발표와 11시 발표 양쪽에 있다 → 11시 발표가 이겨야 한다.
    const target = new Date('2026-07-14T03:00:00Z').getTime();
    const picked = latest.find((r) => r.targetAt.getTime() === target);
    expect(picked?.baseAt.toISOString()).toBe('2026-07-14T02:00:00.000Z'); // 11시 KST 발표
  });

  it('대상 시각별로 1건씩만 남기고 시간 오름차순으로 준다', () => {
    const latest = latestByTarget(parseMarineForecast(REAL_RESPONSE));
    const keys = latest.map((r) => r.targetAt.getTime());
    expect(new Set(keys).size).toBe(keys.length); // 중복 없음
    expect([...keys].sort((a, b) => a - b)).toEqual(keys); // 정렬됨
  });
});

describe('isExpired — 이미 끝난 12시간 구간은 저장하지 않는다', () => {
  const row: MarineFcstRow = {
    regId: '12B10302',
    baseAt: new Date('2026-07-14T02:00:00Z'),
    targetAt: new Date('2026-07-14T03:00:00Z'), // KST 07-14 12:00 ~ 07-15 00:00
    waveHeight: 1.75,
    windDirection: 202,
    windSpeed: 10.5,
    skyCode: 'DB04',
  };

  it('구간이 진행 중이면 남긴다(24h 지평이 걸칠 수 있다)', () => {
    expect(isExpired(row, new Date('2026-07-14T10:00:00Z'))).toBe(false);
  });

  it('구간이 통째로 지나갔으면 버린다(아무도 읽지 않는다)', () => {
    expect(isExpired(row, new Date('2026-07-14T15:00:00Z'))).toBe(true);
  });
});

describe('compassToDegrees — 16방위 변환', () => {
  it.each([
    ['N', 0],
    ['NNE', 22.5],
    ['NE', 45],
    ['E', 90],
    ['SE', 135],
    ['S', 180],
    ['SW', 225],
    ['W', 270],
    ['NW', 315],
    ['NNW', 337.5],
  ])('%s → %d도', (token, deg) => {
    expect(compassToDegrees(token)).toBe(deg);
  });

  it('알 수 없는 토큰(변동/결측)은 null 이다', () => {
    expect(compassToDegrees('-')).toBeNull();
    expect(compassToDegrees('VAR')).toBeNull();
    expect(compassToDegrees(undefined)).toBeNull();
    expect(compassToDegrees('')).toBeNull();
  });
});

describe('circularMeanDegrees — 북쪽을 넘나드는 함정', () => {
  it('NW(315) 와 NE(45) 의 대표 방향은 북(0)이다 — 산술 평균이면 남(180)이 나온다', () => {
    expect(circularMeanDegrees(315, 45)).toBeCloseTo(0);
  });

  it('N(0) 과 NNW(337.5) → 348.75 (0 과 360 경계를 넘어도 맞는다)', () => {
    expect(circularMeanDegrees(0, 337.5)).toBeCloseTo(348.75);
  });

  it('S(180) 과 SW(225) → 202.5 (평범한 구간은 산술 평균과 같다)', () => {
    expect(circularMeanDegrees(180, 225)).toBeCloseTo(202.5);
  });

  it('한쪽만 있으면 그 값을 쓴다', () => {
    expect(circularMeanDegrees(90, null)).toBe(90);
    expect(circularMeanDegrees(null, 90)).toBe(90);
    expect(circularMeanDegrees(null, null)).toBeNull();
  });

  it('정확히 정반대(180도 차)면 대표 방향을 정할 수 없다 → 구간 시작 방위를 쓴다', () => {
    expect(circularMeanDegrees(0, 180)).toBe(0);
  });
});

describe('midpoint — 범위 예보의 대표값', () => {
  it('중앙값을 쓴다 (파고 1.0~2.5 → 1.75)', () => {
    expect(midpoint(1.0, 2.5)).toBeCloseTo(1.75);
  });

  it('한쪽만 있으면 그 값을 쓴다', () => {
    expect(midpoint(null, 2.5)).toBe(2.5);
    expect(midpoint(1.0, null)).toBe(1.0);
    expect(midpoint(null, null)).toBeNull();
  });
});

describe('parseKstStamp — KST 시각 문자열', () => {
  it('YYYYMMDDHHmm(KST) → UTC 인스턴트', () => {
    expect(parseKstStamp('202607140000')?.toISOString()).toBe('2026-07-13T15:00:00.000Z');
    expect(parseKstStamp('202607141200')?.toISOString()).toBe('2026-07-14T03:00:00.000Z');
  });

  it('서버 로컬 타임존과 무관하게 같은 값이다', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = parseKstStamp('202607141100')?.toISOString();
      process.env.TZ = 'Asia/Seoul';
      const kst = parseKstStamp('202607141100')?.toISOString();
      expect(utc).toBe(kst);
      expect(utc).toBe('2026-07-14T02:00:00.000Z');
    } finally {
      process.env.TZ = before;
    }
  });

  it('형식이 어긋나면 null (예외로 죽지 않는다)', () => {
    expect(parseKstStamp('2026071411')).toBeNull(); // 분이 없다
    expect(parseKstStamp('abcd')).toBeNull();
    expect(parseKstStamp(undefined)).toBeNull();
    expect(parseKstStamp('202607149900')).toBeNull(); // 99시
  });
});

describe('issuanceWindow — 발표 구간 조회', () => {
  it('[now-24h, now] 를 KST YYYYMMDDHH 로 만든다 (tmfc=0 은 빈 응답이라 구간으로 물어야 한다)', () => {
    // 2026-07-14T07:46Z = KST 07-14 16:46
    const w = issuanceWindow(new Date('2026-07-14T07:46:00Z'));
    expect(w.tmfc2).toBe('2026071416');
    expect(w.tmfc1).toBe('2026071316');
  });
});

describe('toReading — 저장 형태', () => {
  const row: MarineFcstRow = {
    regId: '12B10302',
    baseAt: new Date('2026-07-14T02:00:00Z'),
    targetAt: new Date('2026-07-15T03:00:00Z'),
    waveHeight: 1.75,
    windDirection: 203,
    windSpeed: 10.5,
    skyCode: 'DB04',
  };

  it('해상예보에 없는 항목(기온·강수량 mm)은 지어내지 않고 null 로 둔다', () => {
    const reading = toReading(7, row);
    expect(reading.airTemp).toBeNull();
    // PREP 은 강수 '유무' 코드(0/1)다 — mm 컬럼에 1 을 넣으면 "강수량 1mm" 라는 거짓이 된다.
    expect(reading.precipitation).toBeNull();
  });

  it('해변 id 와 예보값을 그대로 싣는다', () => {
    expect(toReading(7, row)).toEqual({
      beachId: 7,
      baseAt: row.baseAt,
      targetAt: row.targetAt,
      waveHeight: 1.75,
      windDirection: 203,
      windSpeed: 10.5,
      airTemp: null,
      precipitation: null,
      skyCode: 'DB04',
    });
  });
});
