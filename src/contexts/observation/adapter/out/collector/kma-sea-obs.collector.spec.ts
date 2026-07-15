import { StationInfo } from '../../../domain/station';
import { __test__ } from './kma-sea-obs.collector';

const { parseSeaObs, parseKstCompact, toReading } = __test__;

/** 실제 응답 발췌(주석 헤더 + 정상 지점 + 전 항목 결측 지점). */
const REAL_RESPONSE = [
  '#START7777',
  '#--------------------------------------------------------------',
  '#  1. TP      : 관측종류',
  '#            TM       STN                   STN           LON           LAT     WH   WD     WS     WS     TW     TA      PA     HM',
  'C, 202607140100,    22458,                 중문, 126.39350000,  33.22530000,   1.9, -99, -99.0, -99.0,  25.5,  26.1, 1008.8,  97.0, ,=',
  'B, 202607140100,    22107,                마라도, 126.03330000,  33.08330000,   2.4, 170,   9.3,  11.9,  25.9,  26.3, 1008.8,  99.0, ,=',
  'B, 202607140100,    22108,               외연도 , 125.75000000,  36.25000000, -99.0, -99, -99.0, -99.0, -99.0, -99.0,  -99.0, -99.0, 1111 ,=',
  '#7777END',
].join('\n');

const station = (stationCode: string, stationType: 'marine' | 'weather'): StationInfo => ({
  id: 3,
  sourceId: 2,
  stationCode,
  name: '테스트 지점',
  stationType,
  lat: 33.2253,
  lng: 126.3935,
  isActive: true,
});

describe('parseKstCompact', () => {
  it('YYYYMMDDHHmm(KST) 을 UTC 시각으로 파싱한다', () => {
    // 2026-07-14 01:00 KST === 2026-07-13 16:00 UTC
    expect(parseKstCompact('202607140100')?.toISOString()).toBe('2026-07-13T16:00:00.000Z');
  });

  it('형식이 깨졌으면 null 을 준다', () => {
    expect(parseKstCompact('2026-07-14')).toBeNull();
    expect(parseKstCompact(undefined)).toBeNull();
  });
});

describe('parseSeaObs', () => {
  it('주석(#)과 헤더를 건너뛰고 관측 행만 파싱한다', () => {
    const rows = parseSeaObs(REAL_RESPONSE);

    expect(rows.map((r) => r.stnId)).toEqual(['22458', '22107', '22108']);
  });

  it('결측 표기(-99)를 null 로 바꾼다', () => {
    const jungmun = parseSeaObs(REAL_RESPONSE).find((r) => r.stnId === '22458')!;

    // 파고부이는 풍속을 관측하지 않아 -99 로 온다. -99 가 그대로 저장되면 안 된다.
    expect(jungmun.windSpeed).toBeNull();
    expect(jungmun.windDirection).toBeNull();
    // 파고부이가 주는 항목은 정상 파싱되어야 한다.
    expect(jungmun.waterTemp).toBe(25.5);
    expect(jungmun.waveHeight).toBe(1.9);
  });

  it('전 항목이 결측인 지점도 행으로 파싱한다(품질 판정은 toReading 이 한다)', () => {
    const oeyeondo = parseSeaObs(REAL_RESPONSE).find((r) => r.stnId === '22108')!;

    expect(oeyeondo.waterTemp).toBeNull();
    expect(oeyeondo.waveHeight).toBeNull();
    expect(oeyeondo.windSpeed).toBeNull();
  });
});

describe('toReading', () => {
  const rows = parseSeaObs(REAL_RESPONSE);
  const rowOf = (stnId: string) => rows.find((r) => r.stnId === stnId)!;

  it('관측 항목을 도메인 필드로 매핑한다', () => {
    const r = toReading(station('22107', 'marine'), rowOf('22107'))!;

    expect(r.stationId).toBe(3);
    expect(r.observedAt.toISOString()).toBe('2026-07-13T16:00:00.000Z');
    expect(r.waterTemp).toBe(25.9);
    expect(r.waveHeight).toBe(2.4);
    expect(r.windDirection).toBe(170);
    expect(r.windSpeed).toBe(9.3);
    expect(r.airTemp).toBe(26.3);
    expect(r.qualityFlag).toBe('normal');
  });

  it('KMA 는 유향·유속·염분을 관측하지 않으므로 항상 null 이다', () => {
    // 이 값들은 KHOA 부이(KhoaBuoyCollector)만 제공한다.
    const r = toReading(station('22107', 'marine'), rowOf('22107'))!;

    expect(r.currentDirection).toBeNull();
    expect(r.currentSpeed).toBeNull();
    expect(r.salinity).toBeNull();
    expect(r.precipitation).toBeNull();
  });

  it('일부 항목만 결측인 지점은 정상 행으로 본다 (파고부이는 풍속을 안 준다)', () => {
    const r = toReading(station('22458', 'marine'), rowOf('22458'))!;

    expect(r.windSpeed).toBeNull();
    expect(r.waterTemp).toBe(25.5);
    expect(r.qualityFlag).toBe('normal');
  });

  it('위험도 산출이 쓰는 항목이 전부 결측이면 missing 으로 표시한다', () => {
    const r = toReading(station('22108', 'marine'), rowOf('22108'))!;

    expect(r.qualityFlag).toBe('missing');
    expect(r.waterTemp).toBeNull();
  });

  it('범위를 벗어난 센서값은 버리고 행을 outlier 로 표시한다', () => {
    const r = toReading(station('22107', 'marine'), { ...rowOf('22107'), waterTemp: 99 })!;

    expect(r.waterTemp).toBeNull();
    expect(r.qualityFlag).toBe('outlier');
    // 정상 항목은 살아있어야 한다.
    expect(r.waveHeight).toBe(2.4);
  });
});
