import { PrismaClient } from '@prisma/client';

/**
 * 데모 데이터 시드 (관리자 대시보드 시연용).
 *
 * prisma/seed.ts 의 마스터 데이터(관리자/해변12/룰20/권고/템플릿/데이터소스)가 이미 들어있다는 전제로,
 * 그 위에 "움직이는 데이터"를 얹는다.
 *   - 관측소 4곳 (marine 2 / weather 2) + 해변-관측소 매핑 24건 (해변당 marine 1 + weather 1)
 *   - 관측 시계열 7일치 (3시간 간격, 관측소당 57건)
 *       · 제주 북부 해상(M1)  : 수온 급상승 / 고파고 / 북서 유입풍  → TEMP_UP, TEMP_7D_AVG, WAVE_HIGH, WIND_INFLOW 충족
 *       · 서귀포 남부 해상(M2): 평온한 값                          → 대부분의 관측 룰 미충족
 *   - 해파리 출현/속보 7건 (최근 제주시 속보 3 + 작년 동일 시기 4)   → NEARBY_ALERT / PAST_OCCURRENCE
 *   - 제보 17건 + 동의 로그 (미확인 10 / 그중 독성 의심 4 / 확인완료 6 / 반려 1)
 *   - 운영 대응 기록 8건 (오늘 5 / 어제 3)
 *
 * 시드된 값이 만드는 대시보드(ADM-001) 지표:
 *   unreviewedReportCount = 10, toxicPendingCount = 4, actionCount = 5(당일),
 *   dangerBeachCount = 9, overallRisk = severe   ← 단, 위험도 산출을 한 번 돌린 뒤에 나온다(파일 끝 주석 참고).
 *
 * 실행: npx prisma db seed 가 아니라 별도 스크립트로 돌린다 (package.json 참조).
 * 멱등: 관측소/매핑/관측/출현은 고유키 upsert, 제보/동의/대응은 demo 마커 기준 삭제 후 재생성.
 */
const prisma = new PrismaClient();

// 데모 데이터 식별 마커 (재실행 시 이 마커로 이전 데모 데이터만 골라 지운다)
const DEMO_REPORT_TOKEN_PREFIX = 'demo-rep-';
const DEMO_ACTION_MEMO_PREFIX = '[demo]';
const DEMO_OCCURRENCE_PREFIX = 'DEMO-OCC-';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 관측 시계열: 3시간 간격 × 57개 = 7일(168시간) */
const OBS_STEP_HOURS = 3;
const OBS_SAMPLE_COUNT = 57;

const now = new Date();
/** 정시로 내림한 기준 시각. 같은 시간대에 재실행하면 관측 observedAt 이 동일해 upsert 로 멱등이 된다. */
const hourBase = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

/** 오늘 특정 시각. 아직 오지 않은 시각이면 현재 시각 직전으로 당긴다(미래 데이터 방지). */
function todayAt(hour: number, minute: number): Date {
  const target = new Date(startOfToday.getTime() + hour * HOUR_MS + minute * 60 * 1000);
  const upperBound = new Date(now.getTime() - 5 * 60 * 1000);
  if (target <= upperBound) return target;
  return upperBound > startOfToday ? upperBound : startOfToday;
}

function yesterdayAt(hour: number, minute: number): Date {
  return new Date(startOfToday.getTime() - DAY_MS + hour * HOUR_MS + minute * 60 * 1000);
}

function minusMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() - minutes * 60 * 1000);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 두 좌표의 대권 거리(km). observation_mappings.distance_km 에 저장한다. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return round(2 * R * Math.asin(Math.sqrt(a)), 3);
}

// =====================================================================================
// 관측소 (SYS-001/002)
// =====================================================================================

interface StationSpec {
  sourceCode: 'KHOA_MARINE' | 'KMA_WEATHER';
  stationCode: string;
  name: string;
  stationType: 'marine' | 'weather';
  lat: number;
  lng: number;
}

const STATIONS: StationSpec[] = [
  // 해양 관측(KHOA) — M1 은 "뜨거운" 북부 해역, M2 는 "평온한" 남부 해역
  { sourceCode: 'KHOA_MARINE', stationCode: 'KHOA-JEJU-N', name: '제주 북부 해상 관측소', stationType: 'marine', lat: 33.58, lng: 126.55 },
  { sourceCode: 'KHOA_MARINE', stationCode: 'KHOA-SEOGWIPO-S', name: '서귀포 남부 해상 관측소', stationType: 'marine', lat: 33.2, lng: 126.5 },
  // 기상 관측(KMA)
  { sourceCode: 'KMA_WEATHER', stationCode: 'KMA-JEJU', name: '제주 기상관측소', stationType: 'weather', lat: 33.5141, lng: 126.5297 },
  { sourceCode: 'KMA_WEATHER', stationCode: 'KMA-SEOGWIPO', name: '서귀포 기상관측소', stationType: 'weather', lat: 33.2461, lng: 126.5653 },
];

/** 해변 → (marine, weather) 관측소. 해안(북부/남부) 기준으로 배정한다. */
const BEACH_STATION_MAP: Record<string, { marine: string; weather: string }> = {
  // 제주시 북부 해안 8곳 → 북부 해상(위험 시나리오)
  협재해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  금능으뜸원해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  곽지과물해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  이호테우해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  삼양검은모래해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  함덕해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  김녕성세기해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  월정리해수욕장: { marine: 'KHOA-JEJU-N', weather: 'KMA-JEJU' },
  // 서귀포시 남/동부 해안 4곳 → 남부 해상(평온 시나리오)
  중문색달해수욕장: { marine: 'KHOA-SEOGWIPO-S', weather: 'KMA-SEOGWIPO' },
  화순금모래해수욕장: { marine: 'KHOA-SEOGWIPO-S', weather: 'KMA-SEOGWIPO' },
  표선해수욕장: { marine: 'KHOA-SEOGWIPO-S', weather: 'KMA-SEOGWIPO' },
  신양섭지해수욕장: { marine: 'KHOA-SEOGWIPO-S', weather: 'KMA-SEOGWIPO' },
};

// =====================================================================================
// 관측값 곡선
//   risk-assessment.ts THRESHOLDS 를 그대로 겨냥한다.
//     tempRiseDelta 2.0 / highWaterTemp 26.0 / weekAvgWaterTemp 25.0 / highWave 1.5
//     inflowWindSpeed 5.0 / inflowCurrentSpeed 0.3 / inflowAngleDeg 60
//   i=0(최신) 에서 sin(0)=0 이므로 최신 관측값은 아래 상수 그대로 들어간다.
// =====================================================================================

interface ObsSample {
  waterTemp: number | null;
  salinity: number | null;
  waveHeight: number | null;
  currentDirection: number | null;
  currentSpeed: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  airTemp: number | null;
  precipitation: number | null;
}

function deg(base: number, wiggle: number): number {
  return ((Math.round(base + wiggle) % 360) + 360) % 360;
}

/**
 * 제주 북부 해상(M1) — 위험 시나리오.
 *   최신: 수온 27.4℃(≥26, 3일 최저 24.8 대비 +2.6 ≥2.0) / 파고 1.9m(≥1.5)
 *         풍향 340° 풍속 7.4m/s(≥5.0) / 유향 95° 유속 0.45(≥0.3)
 *   7일 평균 수온 ≈ 25.3℃ (≥25.0)
 */
function marineHot(i: number): ObsSample {
  const h = i * OBS_STEP_HOURS;
  const w = Math.sin(i);
  const waterTemp = h <= 72 ? 27.4 - (h / 72) * 2.6 : 24.8 - ((h - 72) / 96) * 0.2;
  return {
    waterTemp: round(waterTemp + 0.1 * w, 1),
    salinity: round(32.5 + 0.2 * w, 2),
    waveHeight: round(1.9 - (h / 168) * 0.9 + 0.12 * w, 2),
    currentDirection: deg(95, 6 * Math.sin(i * 0.5)),
    currentSpeed: round(0.45 - (h / 168) * 0.2 + 0.03 * w, 2),
    windDirection: deg(340, 8 * Math.sin(i * 0.6)),
    windSpeed: round(7.4 - (h / 168) * 3.0 + 0.25 * w, 2),
    airTemp: round(waterTemp + 1.5 + 0.2 * w, 1),
    precipitation: 0,
  };
}

/**
 * 서귀포 남부 해상(M2) — 평온 시나리오.
 *   최신: 수온 24.9℃(<26, 3일 상승폭 0.6 <2.0) / 파고 1.1m(<1.5)
 *         풍향 200° 풍속 6.2m/s(≥5.0 → 남향 해변만 WIND_INFLOW) / 유속 0.18(<0.3)
 *   7일 평균 수온 ≈ 24.2℃ (<25.0)
 */
function marineCalm(i: number): ObsSample {
  const h = i * OBS_STEP_HOURS;
  const w = Math.sin(i);
  const waterTemp = h <= 72 ? 24.9 - (h / 72) * 0.6 : 24.3 - ((h - 72) / 96) * 0.7;
  return {
    waterTemp: round(waterTemp + 0.08 * w, 1),
    salinity: round(33.1 + 0.2 * w, 2),
    waveHeight: round(1.1 - (h / 168) * 0.5 + 0.08 * w, 2),
    currentDirection: deg(20, 5 * Math.sin(i * 0.5)),
    currentSpeed: round(0.18 - (h / 168) * 0.08 + 0.02 * w, 2),
    windDirection: deg(200, 7 * Math.sin(i * 0.6)),
    windSpeed: round(6.2 - (h / 168) * 2.0 + 0.2 * w, 2),
    airTemp: round(waterTemp + 2.4 + 0.2 * w, 1),
    precipitation: 0,
  };
}

/** 기상 관측소는 수온/파고/해류가 없다(결측). 최신 관측 후보가 되지 않도록 30분 뒤로 밀어 저장한다. */
function weatherOnly(base: ObsSample, airBias: number): ObsSample {
  return {
    waterTemp: null,
    salinity: null,
    waveHeight: null,
    currentDirection: null,
    currentSpeed: null,
    windDirection: base.windDirection,
    windSpeed: base.windSpeed,
    airTemp: base.airTemp === null ? null : round(base.airTemp + airBias, 1),
    precipitation: base.precipitation,
  };
}

// =====================================================================================
// 시드 단계
// =====================================================================================

async function seedStations(): Promise<Map<string, bigint>> {
  const sources = await prisma.dataSource.findMany({
    where: { sourceCode: { in: ['KHOA_MARINE', 'KMA_WEATHER', 'NIFS_JELLYFISH'] } },
    select: { id: true, sourceCode: true },
  });
  const sourceIdByCode = new Map(sources.map((s) => [s.sourceCode, s.id]));
  for (const code of ['KHOA_MARINE', 'KMA_WEATHER', 'NIFS_JELLYFISH']) {
    if (!sourceIdByCode.has(code)) {
      throw new Error(`데이터 소스 ${code} 가 없다. prisma/seed.ts 를 먼저 실행할 것.`);
    }
  }

  const stationIdByCode = new Map<string, bigint>();
  for (const s of STATIONS) {
    const sourceId = sourceIdByCode.get(s.sourceCode)!;
    const row = await prisma.observationStation.upsert({
      where: { uk_observation_stations_code: { sourceId, stationCode: s.stationCode } },
      update: { name: s.name, stationType: s.stationType, lat: s.lat, lng: s.lng, isActive: true },
      create: {
        sourceId,
        stationCode: s.stationCode,
        name: s.name,
        stationType: s.stationType,
        lat: s.lat,
        lng: s.lng,
      },
      select: { id: true },
    });
    stationIdByCode.set(s.stationCode, row.id);
  }
  console.log(`  ✓ 관측소 ${STATIONS.length}곳 (marine 2 / weather 2)`);

  // 수집 현황 화면이 비어보이지 않도록 마지막 동기화 시각을 갱신한다.
  await prisma.dataSource.updateMany({
    where: { sourceCode: { in: ['KHOA_MARINE', 'KMA_WEATHER', 'NIFS_JELLYFISH'] } },
    data: { lastSyncedAt: now, lastSyncStatus: 'success', lastSyncMessage: '데모 시드 수집 완료' },
  });

  return stationIdByCode;
}

async function seedMappings(stationIdByCode: Map<string, bigint>): Promise<void> {
  const stationMeta = new Map(STATIONS.map((s) => [s.stationCode, s]));
  const beaches = await prisma.beach.findMany({
    select: { id: true, name: true, lat: true, lng: true },
  });
  if (beaches.length === 0) throw new Error('해변 데이터가 없다. prisma/seed.ts 를 먼저 실행할 것.');

  let count = 0;
  for (const beach of beaches) {
    const assign = BEACH_STATION_MAP[beach.name];
    if (!assign) continue;
    for (const stationCode of [assign.marine, assign.weather]) {
      const meta = stationMeta.get(stationCode)!;
      const stationId = stationIdByCode.get(stationCode)!;
      const distanceKm = haversineKm(Number(beach.lat), Number(beach.lng), meta.lat, meta.lng);
      await prisma.observationMapping.upsert({
        where: { uk_observation_mappings_pair: { beachId: beach.id, stationId } },
        update: { stationType: meta.stationType, distanceKm, isPrimary: true },
        create: {
          beachId: beach.id,
          stationId,
          stationType: meta.stationType, // marine/weather
          distanceKm,
          isPrimary: true, // CHECK: true 또는 NULL 만 허용 (유형별 대표 1건 보장)
        },
      });
      count += 1;
    }
  }
  console.log(`  ✓ 해변-관측소 매핑 ${count}건 (해변당 marine/weather 대표 1곳씩)`);
}

async function seedObservations(stationIdByCode: Map<string, bigint>): Promise<void> {
  const curves: { stationCode: string; offsetMinutes: number; sample: (i: number) => ObsSample }[] = [
    { stationCode: 'KHOA-JEJU-N', offsetMinutes: 0, sample: marineHot },
    { stationCode: 'KHOA-SEOGWIPO-S', offsetMinutes: 0, sample: marineCalm },
    // 기상 관측은 30분 앞선 시각으로 저장 → 해변의 "최신 관측"은 항상 해양 관측(전 항목 존재)이 된다.
    { stationCode: 'KMA-JEJU', offsetMinutes: 30, sample: (i) => weatherOnly(marineHot(i), 0.6) },
    { stationCode: 'KMA-SEOGWIPO', offsetMinutes: 30, sample: (i) => weatherOnly(marineCalm(i), 0.4) },
  ];

  let count = 0;
  for (const curve of curves) {
    const stationId = stationIdByCode.get(curve.stationCode)!;
    for (let i = 0; i < OBS_SAMPLE_COUNT; i += 1) {
      const observedAt = new Date(
        hourBase.getTime() - i * OBS_STEP_HOURS * HOUR_MS - curve.offsetMinutes * 60 * 1000,
      );
      const s = curve.sample(i);
      await prisma.observation.upsert({
        where: { uk_observations_station_time: { stationId, observedAt } },
        update: { ...s, qualityFlag: 'normal' },
        create: { stationId, observedAt, ...s, qualityFlag: 'normal', collectedAt: observedAt },
      });
      count += 1;
    }
  }
  console.log(`  ✓ 관측 ${count}건 (관측소 4 × 최근 7일 3시간 간격 ${OBS_SAMPLE_COUNT}건)`);
}

async function seedOccurrences(): Promise<void> {
  const source = await prisma.dataSource.findUnique({
    where: { sourceCode: 'NIFS_JELLYFISH' },
    select: { id: true },
  });
  if (!source) throw new Error('데이터 소스 NIFS_JELLYFISH 가 없다. prisma/seed.ts 를 먼저 실행할 것.');

  // region 은 beaches.region 과 정확히 일치해야 한다(risk-input 이 region 동일값으로 조인).
  //   최근 7일 + alert_level(attention/caution/warning) → NEARBY_ALERT (+15)
  //   전 기간 동일 region 출현 이력          → PAST_OCCURRENCE (+15)
  const occurrences = [
    // 제주시: 최근 속보 3건 → NEARBY_ALERT 발동
    { externalId: `${DEMO_OCCURRENCE_PREFIX}N1`, occurredAt: new Date(now.getTime() - 1 * DAY_MS), region: '제주시', lat: 33.5721, lng: 126.6012, species: '노무라입깃해파리', isToxic: true, densityLevel: 'high', alertLevel: 'warning', description: '제주 북부 해역 대형 해파리 다수 출현. 조업/입수 주의보 발령.' },
    { externalId: `${DEMO_OCCURRENCE_PREFIX}N2`, occurredAt: new Date(now.getTime() - 3 * DAY_MS), region: '제주시', lat: 33.5205, lng: 126.4498, species: '보름달물해파리', isToxic: false, densityLevel: 'medium', alertLevel: 'caution', description: '제주 북서 연안 보름달물해파리 띠 형태 출현.' },
    { externalId: `${DEMO_OCCURRENCE_PREFIX}N3`, occurredAt: new Date(now.getTime() - 5 * DAY_MS), region: '제주시', lat: 33.5533, lng: 126.7241, species: '작은상자해파리', isToxic: true, densityLevel: 'low', alertLevel: 'attention', description: '제주 동북 연안 독성종 소수 관측.' },
    // 제주시: 작년 동일 시기 이력 2건 → PAST_OCCURRENCE 만 기여(속보 창 밖)
    { externalId: `${DEMO_OCCURRENCE_PREFIX}P1`, occurredAt: new Date(now.getTime() - 365 * DAY_MS), region: '제주시', lat: 33.5612, lng: 126.5804, species: '노무라입깃해파리', isToxic: true, densityLevel: 'medium', alertLevel: 'caution', description: '전년 동기 제주 북부 출현 기록.' },
    { externalId: `${DEMO_OCCURRENCE_PREFIX}P2`, occurredAt: new Date(now.getTime() - 358 * DAY_MS), region: '제주시', lat: 33.5017, lng: 126.4102, species: '보름달물해파리', isToxic: false, densityLevel: 'low', alertLevel: 'attention', description: '전년 동기 제주 북서 출현 기록.' },
    // 서귀포시: 작년 이력만 2건 → PAST_OCCURRENCE(+15)만, NEARBY_ALERT 는 0
    { externalId: `${DEMO_OCCURRENCE_PREFIX}P3`, occurredAt: new Date(now.getTime() - 366 * DAY_MS), region: '서귀포시', lat: 33.2288, lng: 126.4415, species: '보름달물해파리', isToxic: false, densityLevel: 'medium', alertLevel: 'caution', description: '전년 동기 서귀포 남부 출현 기록.' },
    { externalId: `${DEMO_OCCURRENCE_PREFIX}P4`, occurredAt: new Date(now.getTime() - 372 * DAY_MS), region: '서귀포시', lat: 33.2504, lng: 126.5601, species: '커튼원양해파리', isToxic: false, densityLevel: 'low', alertLevel: 'none', description: '전년 동기 서귀포 연안 소수 관측.' },
  ];

  for (const o of occurrences) {
    const { externalId, ...rest } = o;
    await prisma.jellyfishOccurrence.upsert({
      where: { uk_jellyfish_occurrences_ext: { sourceId: source.id, externalId } },
      // 재실행 시 occurredAt 을 현재 기준으로 다시 당겨야 최근 7일 속보 창에 계속 걸린다.
      update: { ...rest, collectedAt: now },
      create: { sourceId: source.id, externalId, ...rest, collectedAt: now },
    });
  }
  console.log(`  ✓ 해파리 출현/속보 ${occurrences.length}건 (최근 속보 3 / 과거 이력 4)`);
}

interface ReportSpec {
  beachName: string;
  reportType: 'general' | 'multiple' | 'sting';
  status: 'received' | 'ai_processing' | 'ai_done' | 'verified' | 'rejected' | 'hold' | 'reflected';
  aiResult: 'normal' | 'toxic_suspected' | 'unknown' | null;
  aiConfidence: number | null;
  submittedAt: Date;
  note: string;
}

function buildReportSpecs(): ReportSpec[] {
  return [
    // --- 오늘 접수 10건 ---
    { beachName: '협재해수욕장', reportType: 'sting', status: 'verified', aiResult: 'toxic_suspected', aiConfidence: 0.86, submittedAt: todayAt(7, 40), note: '확인완료: 쏘임+독성 의심 → REPORT_STING+REPORT_TOXIC, MIN_TOXIC_STING' },
    { beachName: '함덕해수욕장', reportType: 'general', status: 'ai_done', aiResult: 'toxic_suspected', aiConfidence: 0.92, submittedAt: todayAt(8, 20), note: '미확인 + 독성 의심' },
    { beachName: '삼양검은모래해수욕장', reportType: 'multiple', status: 'verified', aiResult: 'normal', aiConfidence: 0.71, submittedAt: todayAt(9, 5), note: '확인완료: 다수 출현 → REPORT_MULTIPLE' },
    { beachName: '금능으뜸원해수욕장', reportType: 'general', status: 'ai_done', aiResult: 'toxic_suspected', aiConfidence: 0.79, submittedAt: todayAt(10, 15), note: '미확인 + 독성 의심' },
    { beachName: '이호테우해수욕장', reportType: 'general', status: 'ai_done', aiResult: 'normal', aiConfidence: 0.74, submittedAt: todayAt(11, 0), note: '미확인' },
    { beachName: '중문색달해수욕장', reportType: 'general', status: 'received', aiResult: null, aiConfidence: null, submittedAt: todayAt(12, 30), note: '미확인(접수 직후)' },
    { beachName: '표선해수욕장', reportType: 'general', status: 'hold', aiResult: 'unknown', aiConfidence: 0.44, submittedAt: todayAt(13, 10), note: '미확인(보류)' },
    { beachName: '함덕해수욕장', reportType: 'multiple', status: 'received', aiResult: null, aiConfidence: null, submittedAt: todayAt(14, 5), note: '미확인' },
    { beachName: '삼양검은모래해수욕장', reportType: 'general', status: 'ai_processing', aiResult: null, aiConfidence: null, submittedAt: todayAt(15, 20), note: '미확인(AI 처리중)' },
    { beachName: '월정리해수욕장', reportType: 'general', status: 'ai_done', aiResult: 'toxic_suspected', aiConfidence: 0.83, submittedAt: todayAt(16, 0), note: '미확인 + 독성 의심' },
    // --- 어제 접수 7건 ---
    { beachName: '함덕해수욕장', reportType: 'general', status: 'verified', aiResult: 'toxic_suspected', aiConfidence: 0.91, submittedAt: yesterdayAt(10, 30), note: '확인완료: 독성 의심 → REPORT_TOXIC, MIN_TOXIC_HIGH' },
    { beachName: '중문색달해수욕장', reportType: 'multiple', status: 'verified', aiResult: 'toxic_suspected', aiConfidence: 0.83, submittedAt: yesterdayAt(11, 40), note: '확인완료: 독성+다수 → REPORT_TOXIC_MULTIPLE' },
    { beachName: '이호테우해수욕장', reportType: 'general', status: 'reflected', aiResult: 'normal', aiConfidence: 0.66, submittedAt: yesterdayAt(13, 15), note: '위험도 반영됨 → REPORT_GENERAL' },
    { beachName: '곽지과물해수욕장', reportType: 'sting', status: 'ai_done', aiResult: 'toxic_suspected', aiConfidence: 0.88, submittedAt: yesterdayAt(15, 50), note: '미확인 + 독성 의심(쏘임)' },
    { beachName: '김녕성세기해수욕장', reportType: 'general', status: 'rejected', aiResult: 'normal', aiConfidence: 0.35, submittedAt: yesterdayAt(16, 30), note: '반려(해파리 아님)' },
    { beachName: '화순금모래해수욕장', reportType: 'general', status: 'ai_done', aiResult: 'normal', aiConfidence: 0.58, submittedAt: yesterdayAt(17, 20), note: '미확인' },
    // 화순: 관측 점수 30(safe 경계) + REPORT_GENERAL(+10) → 40 = caution.
    // 대시보드/지도에 safe/caution/danger/severe 4단계가 모두 나오게 하려고 넣은 건이다.
    { beachName: '화순금모래해수욕장', reportType: 'general', status: 'verified', aiResult: 'normal', aiConfidence: 0.69, submittedAt: yesterdayAt(18, 5), note: '확인완료: 일반 발견 → REPORT_GENERAL' },
  ];
}

async function seedReports(): Promise<void> {
  const beaches = await prisma.beach.findMany({ select: { id: true, name: true, lat: true, lng: true } });
  const beachByName = new Map(beaches.map((b) => [b.name, b]));

  // 멱등: 이전 데모 제보를 지운다. report_consents/vision_results/report_reviews 는 FK CASCADE 로 함께 사라지고,
  // risk_factors.source_report_id 는 SET NULL 된다. 동의 로그는 제보를 지운 뒤에야 지울 수 있다(RESTRICT).
  await prisma.jellyfishReport.deleteMany({
    where: { reporterToken: { startsWith: DEMO_REPORT_TOKEN_PREFIX } },
  });
  await prisma.consentLog.deleteMany({
    where: { userToken: { startsWith: DEMO_REPORT_TOKEN_PREFIX } },
  });

  const specs = buildReportSpecs();
  let consentCount = 0;

  for (const [index, spec] of specs.entries()) {
    const beach = beachByName.get(spec.beachName);
    if (!beach) throw new Error(`해변 ${spec.beachName} 가 없다. prisma/seed.ts 를 먼저 실행할 것.`);

    const seq = String(index + 1).padStart(2, '0');
    const token = `${DEMO_REPORT_TOKEN_PREFIX}${seq}`;
    const occurredAt = minusMinutes(spec.submittedAt, 45);
    // 제보 위치는 해변 좌표 근처로 흩뿌린다(±0.002도 ≈ 200m).
    const jitter = ((index % 5) - 2) * 0.002;

    // PRIV-001 / REPORT-001: 사진·위치 동의 없이는 제보를 제출할 수 없다.
    const consentTypes = ['privacy', 'location', 'image'] as const;
    const consentIds: bigint[] = [];
    for (const consentType of consentTypes) {
      const log = await prisma.consentLog.create({
        data: {
          userToken: token, // 익명 제보 → user_id 는 NULL (CHECK: user_id 또는 user_token 필요)
          consentType,
          agreed: true,
          policyVersion: 'v1.0',
          agreedAt: minusMinutes(spec.submittedAt, 2),
          ipAddress: `203.0.113.${(index % 200) + 10}`,
        },
        select: { id: true },
      });
      consentIds.push(log.id);
      consentCount += 1;
    }

    const report = await prisma.jellyfishReport.create({
      data: {
        beachId: beach.id,
        reporterToken: token, // 익명 제보
        lat: Number(beach.lat) + jitter,
        lng: Number(beach.lng) - jitter,
        imageUrl: `https://demo.jellysafe.local/uploads/reports/demo-${seq}.jpg`,
        thumbnailUrl: `https://demo.jellysafe.local/uploads/reports/demo-${seq}_thumb.jpg`,
        reportType: spec.reportType,
        status: spec.status,
        aiResult: spec.aiResult,
        aiConfidence: spec.aiConfidence,
        occurredAt,
        submittedAt: spec.submittedAt,
        reflectedAt:
          spec.status === 'reflected' ? new Date(spec.submittedAt.getTime() + HOUR_MS) : null,
      },
      select: { id: true },
    });

    for (const consentLogId of consentIds) {
      await prisma.reportConsent.create({
        data: { reportId: report.id, consentLogId, createdAt: spec.submittedAt },
      });
    }
  }

  const unreviewed = specs.filter((s) =>
    ['received', 'ai_processing', 'ai_done', 'hold'].includes(s.status),
  );
  const toxicPending = unreviewed.filter((s) => s.aiResult === 'toxic_suspected');
  const verified = specs.filter((s) => ['verified', 'reflected'].includes(s.status));

  console.log(`  ✓ 동의 로그 ${consentCount}건 (제보당 privacy/location/image)`);
  console.log(
    `  ✓ 제보 ${specs.length}건 — 미확인 ${unreviewed.length}(그중 독성 의심 ${toxicPending.length}) / 확인완료 ${verified.length} / 반려 1`,
  );
}

async function seedOperationActions(): Promise<void> {
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@jellysafe.local' },
    select: { id: true },
  });
  if (!admin) throw new Error('관리자 계정이 없다. prisma/seed.ts 를 먼저 실행할 것.');

  const beaches = await prisma.beach.findMany({ select: { id: true, name: true } });
  const beachIdByName = new Map(beaches.map((b) => [b.name, b.id]));

  const recs = await prisma.riskRecommendation.findMany({ select: { id: true, actionCode: true } });
  const recIdByCode = new Map(recs.map((r) => [r.actionCode, r.id]));

  // 멱등: 이전 데모 대응 기록만 지운다(operation_status_logs 는 SET NULL).
  await prisma.operationAction.deleteMany({
    where: { memo: { startsWith: DEMO_ACTION_MEMO_PREFIX } },
  });

  const actions = [
    // --- 오늘 5건 → 대시보드 actionCount ---
    { beachName: '협재해수욕장', actionCode: 'ENTRY_BAN', operationStatus: 'entry_ban', createdAt: todayAt(8, 10), memo: '쏘임 사고 제보 확인, 전 구역 입수 통제' },
    { beachName: '협재해수욕장', actionCode: 'BROADCAST', operationStatus: 'broadcast', createdAt: todayAt(8, 25), memo: '해파리 주의 안내방송 30분 간격 실시' },
    { beachName: '함덕해수욕장', actionCode: 'ENTRY_CAUTION', operationStatus: 'entry_caution', createdAt: todayAt(9, 40), memo: '독성 의심 제보 확인, 입수 주의 안내 및 안전선 조정' },
    { beachName: '삼양검은모래해수욕장', actionCode: 'LIFEGUARD_ADD', operationStatus: 'lifeguard_added', createdAt: todayAt(10, 50), memo: '다수 출현 제보 반영, 안전요원 2명 추가 배치' },
    { beachName: '중문색달해수욕장', actionCode: 'MONITORING_UP', operationStatus: 'monitoring_up', createdAt: todayAt(13, 30), memo: '독성 의심 제보 확인, 순찰 주기 단축' },
    // --- 어제 3건 (전일 대비 비교용) ---
    { beachName: '이호테우해수욕장', actionCode: 'MONITORING_UP', operationStatus: 'monitoring_up', createdAt: yesterdayAt(11, 15), memo: '수온 상승 추세, 모니터링 강화' },
    { beachName: '함덕해수욕장', actionCode: 'BROADCAST', operationStatus: 'broadcast', createdAt: yesterdayAt(14, 20), memo: '인근 해역 속보 안내방송' },
    { beachName: '표선해수욕장', actionCode: null, operationStatus: 'resumed', createdAt: yesterdayAt(16, 45), memo: '해파리 미발견, 정상 운영 재개' },
  ];

  for (const a of actions) {
    const beachId = beachIdByName.get(a.beachName);
    if (!beachId) throw new Error(`해변 ${a.beachName} 가 없다. prisma/seed.ts 를 먼저 실행할 것.`);
    await prisma.operationAction.create({
      data: {
        beachId,
        riskScoreId: null, // 시드 시점에는 risk_scores 가 없다(산출 API 실행 후 생성).
        recommendationId: a.actionCode ? (recIdByCode.get(a.actionCode) ?? null) : null,
        actionType: a.actionCode,
        operationStatus: a.operationStatus, // CHECK: normal/monitoring_up/entry_caution/lifeguard_added/broadcast/zone_control_review/entry_ban/resumed
        memo: `${DEMO_ACTION_MEMO_PREFIX} ${a.memo}`,
        createdBy: admin.id,
        createdAt: a.createdAt,
      },
    });
  }

  const todayCount = actions.filter((a) => a.createdAt >= startOfToday).length;
  console.log(`  ✓ 대응 기록 ${actions.length}건 (오늘 ${todayCount} / 어제 ${actions.length - todayCount})`);
}

async function main() {
  console.log('JellySafe 데모 데이터 시드 시작...');
  const stationIdByCode = await seedStations();
  await seedMappings(stationIdByCode);
  await seedObservations(stationIdByCode);
  await seedOccurrences();
  await seedReports();
  await seedOperationActions();
  console.log('데모 데이터 시드 완료.');
  console.log('');
  console.log('  다음: POST /system/risk/calculate 를 호출해야 risk_scores 가 생성된다.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// =====================================================================================
//  이 데모 데이터를 넣은 뒤 `POST /system/risk/calculate` 를 호출해야 risk_scores 가 생성되어
//  대시보드에 반영된다. (관측/출현/확인완료 제보는 위험도 산출의 "입력"일 뿐, 점수 자체가 아니다.)
//
//  호출 전:  overallRisk=safe, dangerBeachCount=0  (risk_scores 가 비어 있으므로)
//  호출 후:  overallRisk=severe, dangerBeachCount=9
//            severe 5 (협재 100 / 함덕 95 / 삼양 85 / 이호테우 80 / 금능 80)
//            danger 4 (곽지 70 / 김녕 70 / 월정리 70 / 중문 65)
//            caution 1 (화순 40)   safe 2 (표선 20 / 신양섭지 20)
//
//  제보/대응 카운트는 산출과 무관하게 시드 직후부터 바로 보인다:
//            unreviewedReportCount=10, toxicPendingCount=4, actionCount=5(당일)
// =====================================================================================
