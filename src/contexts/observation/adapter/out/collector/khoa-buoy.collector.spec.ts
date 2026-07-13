import { StationInfo } from '../../../domain/station';
import { __test__ } from './khoa-buoy.collector';

const { toReading, parseKst } = __test__;

const station: StationInfo = {
  id: 7,
  sourceId: 1,
  stationCode: 'TW_0075',
  name: '중문해수욕장 해양관측부이',
  stationType: 'marine',
  lat: 33.2345,
  lng: 126.40955,
  isActive: true,
};

/** 실제 API 응답에서 그대로 가져온 1건(TW_0075). */
const REAL_ITEM = {
  obsrvnDt: '2026-07-14 01:30',
  wtem: 25.2,
  slnty: 29.32,
  wvhgt: 2.0,
  crdir: 166.18,
  crsp: 16.5, // cm/s
  wndrct: 220.58,
  wspd: 4.5,
  artmp: 24.8,
};

describe('parseKst', () => {
  it('KST 문자열을 UTC 시각으로 파싱한다 (서버 타임존과 무관)', () => {
    // 2026-07-14 01:30 KST === 2026-07-13 16:30 UTC
    expect(parseKst('2026-07-14 01:30')?.toISOString()).toBe('2026-07-13T16:30:00.000Z');
  });

  it('형식이 깨졌거나 없으면 null 을 준다', () => {
    expect(parseKst(undefined)).toBeNull();
    expect(parseKst('어제')).toBeNull();
  });
});

describe('toReading', () => {
  it('실제 응답 필드를 도메인 필드로 매핑한다', () => {
    const r = toReading(station, REAL_ITEM)!;

    expect(r.stationId).toBe(station.id);
    expect(r.waterTemp).toBe(25.2);
    expect(r.salinity).toBe(29.32);
    expect(r.waveHeight).toBe(2.0);
    expect(r.currentDirection).toBe(166.18);
    expect(r.windDirection).toBe(220.58);
    expect(r.windSpeed).toBe(4.5);
    expect(r.airTemp).toBe(24.8);
    expect(r.qualityFlag).toBe('normal');
  });

  it('유속을 cm/s → m/s 로 변환한다 (THRESHOLDS.inflowCurrentSpeed 가 m/s 기준)', () => {
    // 변환하지 않으면 16.5 가 임계치 0.3 m/s 를 55배 초과해 CURRENT_INFLOW 가 상시 발화한다.
    expect(toReading(station, REAL_ITEM)!.currentSpeed).toBeCloseTo(0.165, 6);
  });

  it('부이는 강수를 관측하지 않으므로 precipitation 은 항상 null 이다', () => {
    expect(toReading(station, REAL_ITEM)!.precipitation).toBeNull();
  });

  it('범위를 벗어난 센서값은 버리고 행을 outlier 로 표시한다', () => {
    // 실제로 관측된 결함값: 염분 54.92 psu (해수는 통상 30~35)
    const r = toReading(station, { ...REAL_ITEM, slnty: 54.92 })!;

    expect(r.salinity).toBeNull();
    expect(r.qualityFlag).toBe('outlier');
    // 정상 항목은 그대로 살아있어야 한다.
    expect(r.waterTemp).toBe(25.2);
  });

  it('결측 필드는 null 로 두고 정상 행으로 본다', () => {
    const r = toReading(station, { ...REAL_ITEM, wvhgt: null })!;

    expect(r.waveHeight).toBeNull();
    expect(r.qualityFlag).toBe('normal');
  });

  it('위험도 산출이 쓰는 항목이 전부 비면 missing 으로 표시한다', () => {
    const r = toReading(station, {
      obsrvnDt: '2026-07-14 01:30',
      wtem: null,
      wvhgt: null,
      wspd: null,
      crsp: null,
    })!;

    expect(r.qualityFlag).toBe('missing');
  });

  it('관측시각이 없으면 저장할 수 없으므로 null 을 반환한다', () => {
    expect(toReading(station, { ...REAL_ITEM, obsrvnDt: undefined })).toBeNull();
  });
});
