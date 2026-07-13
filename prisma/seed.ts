import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * 초기 시드 데이터.
 *   - 관리자 계정 1 (admin@jellysafe.local / admin1234)
 *   - 프론트 연동용 기본 로그인 계정 (test@jellysafe.local / test1234)
 *   - 제주 지정 해수욕장 12곳 (제주시 8, 서귀포시 4. priority 1~5 는 MVP 1순위)
 *   - 위험도 룰 점수표 (03_Data_AI): 위험 변수 / 제보 가중치 / 위험 단계 구간 / 최소 단계 보장
 *   - 위험 단계별 대응 권고 (ADM-006)
 *   - 안전/고지 문구 (G-006, DISCLAIMER-001)
 *   - 알림 문구 템플릿 (ADM-010)
 *   - 데이터 소스 (SYS-001, MVP 샘플)
 *
 * 실행: npx prisma db seed   (package.json 의 prisma.seed 참조)
 * 멱등: 고유키 기준 upsert 라 여러 번 실행해도 안전하다.
 */
const prisma = new PrismaClient();

// user 도메인 password.ts 와 동일한 scrypt salt:hash 포맷
function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

async function seedAdmin() {
  const email = 'admin@jellysafe.local';
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      role: 'admin',
      passwordHash: hashPassword('admin1234'),
      name: '시스템 관리자',
      organization: '제주도 해양수산국',
    },
  });
  console.log('  ✓ 관리자 계정 (admin@jellysafe.local / admin1234)');
}

/**
 * 프론트엔드 연동용 기본 로그인 계정.
 * 재시드해도 비밀번호가 test1234 로 복구되도록 update 에도 해시를 넣는다
 * (다른 시드와 달리 update:{} 가 아니다 — 데모 계정이 잠기면 프론트 개발이 막히므로).
 */
async function seedTestUser() {
  const email = 'test@jellysafe.local';
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hashPassword('test1234'), isActive: true },
    create: {
      email,
      role: 'admin',
      passwordHash: hashPassword('test1234'),
      name: '테스트 계정',
      organization: 'JellySafe',
    },
  });
  console.log('  ✓ 기본 로그인 계정 (test@jellysafe.local / test1234)');
}

async function seedBeaches() {
  // 제주특별자치도 지정 해수욕장 12곳 (제주시 8, 서귀포시 4).
  // priority 1~5 는 기능정의서상 MVP 1순위(협재/함덕/이호테우/중문/표선), 6~12 는 나머지 지정 해변.
  // 좌표/방위각/취약도는 초기값이며 실운영 전 PM 확정 대상이다.
  const beaches = [
    // --- MVP 1순위 5곳 ---
    { name: '협재해수욕장', region: '제주시', lat: 33.3941, lng: 126.2396, facingDirection: 315, priority: 1, vulnerabilityScore: 15 },
    { name: '함덕해수욕장', region: '제주시', lat: 33.5432, lng: 126.6698, facingDirection: 0, priority: 2, vulnerabilityScore: 20 },
    { name: '이호테우해수욕장', region: '제주시', lat: 33.4986, lng: 126.4525, facingDirection: 340, priority: 3, vulnerabilityScore: 10 },
    { name: '중문색달해수욕장', region: '서귀포시', lat: 33.2447, lng: 126.4103, facingDirection: 180, priority: 4, vulnerabilityScore: 10 },
    { name: '표선해수욕장', region: '서귀포시', lat: 33.3262, lng: 126.8339, facingDirection: 135, priority: 5, vulnerabilityScore: 5 },
    // --- 나머지 제주 지정 해수욕장 7곳 ---
    { name: '곽지과물해수욕장', region: '제주시', lat: 33.4514, lng: 126.3050, facingDirection: 340, priority: 6, vulnerabilityScore: 10 },
    { name: '금능으뜸원해수욕장', region: '제주시', lat: 33.3889, lng: 126.2372, facingDirection: 315, priority: 7, vulnerabilityScore: 10 },
    { name: '삼양검은모래해수욕장', region: '제주시', lat: 33.5183, lng: 126.5972, facingDirection: 0, priority: 8, vulnerabilityScore: 10 },
    { name: '김녕성세기해수욕장', region: '제주시', lat: 33.5588, lng: 126.7566, facingDirection: 0, priority: 9, vulnerabilityScore: 5 },
    { name: '월정리해수욕장', region: '제주시', lat: 33.5563, lng: 126.7955, facingDirection: 0, priority: 10, vulnerabilityScore: 5 },
    { name: '화순금모래해수욕장', region: '서귀포시', lat: 33.2419, lng: 126.3389, facingDirection: 200, priority: 11, vulnerabilityScore: 5 },
    { name: '신양섭지해수욕장', region: '서귀포시', lat: 33.4351, lng: 126.9130, facingDirection: 90, priority: 12, vulnerabilityScore: 5 },
  ];
  for (const b of beaches) {
    await prisma.beach.upsert({ where: { name: b.name }, update: {}, create: b });
  }
  console.log(`  ✓ 해변 ${beaches.length}곳 (제주 지정 해수욕장)`);
}

async function seedRiskRules() {
  const version = 'v1';
  type Rule = {
    ruleCode: string;
    ruleCategory: string;
    ruleName: string;
    score?: number;
    minRiskLevel?: string;
    conditionJson?: unknown;
  };
  const rules: Rule[] = [
    // 위험 변수 (risk_variable)
    { ruleCode: 'TEMP_UP', ruleCategory: 'risk_variable', ruleName: '최근 3일 수온 상승', score: 10, conditionJson: { window_days: 3, delta_c: 1.5 } },
    { ruleCode: 'TEMP_7D_AVG', ruleCategory: 'risk_variable', ruleName: '최근 7일 평균 수온 높음', score: 5, conditionJson: { window_days: 7, threshold_c: 24 } },
    { ruleCode: 'WAVE_HIGH', ruleCategory: 'risk_variable', ruleName: '파고 높음', score: 10, conditionJson: { threshold_m: 1.5 } },
    { ruleCode: 'WIND_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 풍향', score: 10, conditionJson: { angle_tolerance: 45 } },
    { ruleCode: 'CURRENT_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 해류', score: 10, conditionJson: { angle_tolerance: 45 } },
    { ruleCode: 'PAST_OCCURRENCE', ruleCategory: 'risk_variable', ruleName: '과거 동일 시기 출현 이력', score: 15 },
    { ruleCode: 'NEARBY_ALERT', ruleCategory: 'risk_variable', ruleName: '인근 해역 해파리 속보', score: 15, conditionJson: { radius_km: 30 } },
    { ruleCode: 'BEACH_VULNERABILITY', ruleCategory: 'risk_variable', ruleName: '해수욕장 취약도', score: 5 },
    // 제보 가중치 (report_weight)
    { ruleCode: 'REPORT_GENERAL', ruleCategory: 'report_weight', ruleName: '일반 해파리 발견 제보', score: 10 },
    { ruleCode: 'REPORT_MULTIPLE', ruleCategory: 'report_weight', ruleName: '다수 출현 제보', score: 15 },
    { ruleCode: 'REPORT_TOXIC', ruleCategory: 'report_weight', ruleName: '독성 해파리 의심 제보', score: 25 },
    { ruleCode: 'REPORT_TOXIC_MULTIPLE', ruleCategory: 'report_weight', ruleName: '독성 의심 + 다수 출현 제보', score: 35 },
    { ruleCode: 'REPORT_STING', ruleCategory: 'report_weight', ruleName: '쏘임 사고 제보', score: 40 },
    // 위험 단계 구간 (level_threshold) — RISK-001
    { ruleCode: 'LEVEL_SAFE', ruleCategory: 'level_threshold', ruleName: '안전 0~30', conditionJson: { min: 0, max: 30 } },
    { ruleCode: 'LEVEL_CAUTION', ruleCategory: 'level_threshold', ruleName: '주의 31~55', conditionJson: { min: 31, max: 55 } },
    { ruleCode: 'LEVEL_DANGER', ruleCategory: 'level_threshold', ruleName: '위험 56~75', conditionJson: { min: 56, max: 75 } },
    { ruleCode: 'LEVEL_SEVERE', ruleCategory: 'level_threshold', ruleName: '심각 76~100', conditionJson: { min: 76, max: 100 } },
    // 최소 단계 보장 (min_level) — RISK-002
    { ruleCode: 'MIN_TOXIC_1', ruleCategory: 'min_level', ruleName: '독성 의심 1건 → 최소 주의', minRiskLevel: 'caution' },
    { ruleCode: 'MIN_TOXIC_HIGH', ruleCategory: 'min_level', ruleName: '독성 의심 + 신뢰도 높음 → 최소 위험', minRiskLevel: 'danger', conditionJson: { confidence_gte: 0.8 } },
    { ruleCode: 'MIN_TOXIC_STING', ruleCategory: 'min_level', ruleName: '독성 의심 + 쏘임 → 최소 심각', minRiskLevel: 'severe' },
  ];
  for (const r of rules) {
    await prisma.riskRuleConfig.upsert({
      where: { uk_risk_rule_configs_code_version: { ruleCode: r.ruleCode, version } },
      update: {},
      create: {
        ruleCode: r.ruleCode,
        ruleCategory: r.ruleCategory,
        ruleName: r.ruleName,
        score: r.score ?? null,
        minRiskLevel: r.minRiskLevel ?? null,
        conditionJson: (r.conditionJson ?? undefined) as never,
        version,
        active: true,
      },
    });
  }
  console.log(`  ✓ 위험도 룰 ${rules.length}건 (version=${version})`);
}

async function seedRecommendations() {
  const recs = [
    { actionCode: 'MONITORING_UP', riskLevel: 'caution', title: '모니터링 강화', description: '해파리 출현 가능성이 있어 현장 관찰을 강화합니다.', displayOrder: 1 },
    { actionCode: 'ENTRY_CAUTION', riskLevel: 'danger', title: '입수 주의 안내', description: '입수 시 주의를 안내하고 안전요원 배치를 강화합니다.', displayOrder: 1 },
    { actionCode: 'LIFEGUARD_ADD', riskLevel: 'danger', title: '안전요원 추가 배치', description: '위험 구역에 안전요원을 추가 배치합니다.', displayOrder: 2 },
    { actionCode: 'BROADCAST', riskLevel: 'danger', title: '안내방송 실시', description: '해파리 주의 안내방송을 실시합니다.', displayOrder: 3 },
    { actionCode: 'ZONE_CONTROL_REVIEW', riskLevel: 'severe', title: '구역 폐쇄 검토', description: '입수 통제 및 구역 폐쇄를 검토합니다.', displayOrder: 1 },
    { actionCode: 'ENTRY_BAN', riskLevel: 'severe', title: '입수 통제', description: '입수를 통제하고 긴급 안내를 실시합니다.', displayOrder: 2 },
  ];
  for (const r of recs) {
    await prisma.riskRecommendation.upsert({ where: { actionCode: r.actionCode }, update: {}, create: r });
  }
  console.log(`  ✓ 대응 권고 ${recs.length}건`);
}

async function seedGuides() {
  const guides = [
    { guideCode: 'DISCLAIMER_PUBLIC', targetType: 'public', title: '위험도 참고 정보 안내', body: 'JellySafe 위험도는 참고 정보이며, 현장 안전요원 및 운영기관의 최종 안내가 우선합니다.', displayOrder: 1 },
    { guideCode: 'DISCLAIMER_ADMIN', targetType: 'admin', title: '운영 판단 안내', body: 'AI 판별 결과는 관리자 확인 전 확정 데이터가 아닙니다. 운영기관 기준에 따라 최종 조치하세요.', displayOrder: 1 },
    { guideCode: 'SAFETY_SEVERE', targetType: 'public', riskLevel: 'severe', title: '심각 단계 안전 안내', body: '입수를 자제하고 대체 해변 이용을 권장합니다. 쏘임 시 즉시 안전요원에게 알리세요.', displayOrder: 2 },
  ];
  for (const g of guides) {
    await prisma.staticGuide.upsert({ where: { guideCode: g.guideCode }, update: {}, create: g });
  }
  console.log(`  ✓ 안내/고지 문구 ${guides.length}건`);
}

async function seedNotificationTemplates() {
  const templates = [
    { templateCode: 'LEVEL_UP_OPERATOR', targetType: 'operator', eventType: 'level_up', title: '위험 단계 상승', body: '{beachName} 위험도가 {riskLevel} 단계로 상승했습니다. 대응 권고를 확인해주세요.' },
    { templateCode: 'TOXIC_OPERATOR', targetType: 'operator', eventType: 'toxic_report', title: '독성 의심 제보', body: '{beachName}에 독성 해파리 의심 제보가 접수되었습니다. 검수를 진행해주세요.' },
    { templateCode: 'STING_OPERATOR', targetType: 'operator', eventType: 'sting_report', title: '쏘임 사고 제보', body: '{beachName}에 쏘임 사고 제보가 접수되었습니다. 즉시 확인이 필요합니다.' },
    { templateCode: 'LEVEL_UP_PUBLIC', targetType: 'public', eventType: 'level_up', title: '관심 해변 위험도 상승', body: '{beachName} 위험도가 {riskLevel} 단계입니다. 방문 전 확인이 필요합니다.' },
  ];
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({ where: { templateCode: t.templateCode }, update: {}, create: t });
  }
  console.log(`  ✓ 알림 템플릿 ${templates.length}건`);
}

async function seedDataSources() {
  const sources = [
    { sourceCode: 'NIFS_JELLYFISH', name: '국립수산과학원 해파리 출현/속보', provider: '국립수산과학원', sourceType: 'jellyfish', isSample: true, syncIntervalMinutes: 60, endpointUrl: null },
    // KHOA 해양관측부이는 실 OpenAPI 연동 완료(KhoaBuoyCollector). 샘플이 아니다.
    { sourceCode: 'KHOA_MARINE', name: '국립해양조사원 해양관측부이 (수온/염분/파고/유향·유속)', provider: '국립해양조사원', sourceType: 'marine', isSample: false, syncIntervalMinutes: 30, endpointUrl: 'https://apis.data.go.kr/1192136/twRecent/GetTWRecentApiService' },
    // 기상청 해양기상종합관측은 실 OpenAPI 연동 완료(KmaSeaObsCollector). 제주 해역 실관측 지점을 커버한다.
    // sourceType 은 소스 단위 값이라 'marine' 으로 두고, 지점별 marine/weather 구분은 station_type 이 담는다.
    { sourceCode: 'KMA_SEA_OBS', name: '기상청 해양기상종합관측 (수온/파고/풍향·풍속)', provider: '기상청', sourceType: 'marine', isSample: false, syncIntervalMinutes: 30, endpointUrl: 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php' },
    { sourceCode: 'KMA_WEATHER', name: '기상청 기상 관측 (풍향/풍속/기온)', provider: '기상청', sourceType: 'weather', isSample: true, syncIntervalMinutes: 30, endpointUrl: null },
    { sourceCode: 'BEACH_MASTER', name: '해수욕장 위치 마스터', provider: '제주특별자치도', sourceType: 'beach', isSample: true, endpointUrl: null },
  ];
  for (const s of sources) {
    // 소스 서술 필드는 재시드 시 수렴해야 하므로 update 에도 넣는다(lastSync* 는 건드리지 않는다).
    const { sourceCode, ...rest } = s;
    await prisma.dataSource.upsert({ where: { sourceCode }, update: rest, create: s });
  }
  console.log(`  ✓ 데이터 소스 ${sources.length}건`);
}

/**
 * 관측소 마스터 (SYS-001/002) — 제주 해역 실관측소.
 *
 * 두 소스를 함께 등록해 상호 보완한다:
 *
 *  - **기상청(KMA_SEA_OBS) 21지점** — 커버리지 담당. 협재·중문·김녕 등 해수욕장 앞바다에
 *    파고부이가 있어 해변별 수온·파고가 실제로 갈린다. 다만 유향·유속·염분은 관측하지 않는다.
 *  - **국립해양조사원(KHOA_MARINE) 1지점** — 유향·유속·염분을 주는 유일한 소스지만
 *    제주 해역 부이가 중문(TW_0075) 하나뿐이다(TW_0001~TW_0200 전수 조회로 확인).
 *
 * station_type 은 지점이 실제로 주는 항목으로 정한다(risk-input 이 marine/weather 를 나눠 조회한다):
 *   해양기상부이·파고부이 → marine (수온/파고)
 *   항만기상·등표·해양환경 → weather (풍향/풍속)
 *
 * 기상청 '기상1호'(22003)는 관측선이라 좌표가 고정이 아니다. SYS-002 최근접 매핑이
 * 틀어지므로 등록하지 않는다.
 */
async function seedObservationStations() {
  const sources = await prisma.dataSource.findMany({
    where: { sourceCode: { in: ['KMA_SEA_OBS', 'KHOA_MARINE'] } },
  });
  const sourceIdOf = new Map(sources.map((s) => [s.sourceCode, s.id]));
  for (const code of ['KMA_SEA_OBS', 'KHOA_MARINE']) {
    if (!sourceIdOf.has(code)) {
      throw new Error(`${code} 데이터 소스가 없습니다 — seedDataSources 를 먼저 실행하세요.`);
    }
  }

  const stations = [
    // --- 기상청 해양기상종합관측. stationCode = 기상청 지점번호(STN_ID) ---
    // 여기 있는 지점은 전부 실호출로 값이 오는 것을 확인했다. 응답이 아예 없거나
    // 전 항목이 결측(-99)인 지점(항만기상 4곳, 지귀도 등표, 가파도·하도 파고부이)은
    // 일부러 뺐다. 등록해두면 SYS-002 가 해변을 그쪽에 매핑해버려서, 실측 부이가
    // 옆에 있는데도 관측이 비어 신뢰도만 떨어진다.
    // 해양기상부이 (수온/파고/풍속)
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22107', name: '마라도 해양기상부이', stationType: 'marine', lat: 33.0833, lng: 126.0333 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22187', name: '서귀포 해양기상부이', stationType: 'marine', lat: 33.1281, lng: 127.0228 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22514', name: '구엄 해양기상부이', stationType: 'marine', lat: 33.520961, lng: 126.37485 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22515', name: '위미 해양기상부이', stationType: 'marine', lat: 33.22369, lng: 126.71119 },
    // 파고부이 (수온/파고) — 해수욕장 앞바다에 위치해 해변별 위험도의 핵심 데이터원이다.
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22457', name: '제주항 파고부이', stationType: 'marine', lat: 33.525, lng: 126.4935 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22458', name: '중문 파고부이', stationType: 'marine', lat: 33.2253, lng: 126.3935 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22469', name: '우도 파고부이', stationType: 'marine', lat: 33.5222, lng: 126.9667 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22486', name: '협재 파고부이', stationType: 'marine', lat: 33.4005, lng: 126.2092 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22491', name: '김녕 파고부이', stationType: 'marine', lat: 33.5818, lng: 126.7638 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22495', name: '신산 파고부이', stationType: 'marine', lat: 33.3777, lng: 126.9057 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22505', name: '영락 파고부이', stationType: 'marine', lat: 33.2385, lng: 126.1948 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '22516', name: '신창 파고부이', stationType: 'marine', lat: 33.368, lng: 126.1093 },
    // 해양환경 (풍속)
    { sourceCode: 'KMA_SEA_OBS', stationCode: '33011', name: '판포 해양환경', stationType: 'weather', lat: 33.36686, lng: 126.20052 },
    { sourceCode: 'KMA_SEA_OBS', stationCode: '33015', name: '서귀포 해양환경', stationType: 'weather', lat: 33.2635, lng: 126.6426 },

    // --- 국립해양조사원 해양관측부이 (유향·유속·염분 공급원) ---
    { sourceCode: 'KHOA_MARINE', stationCode: 'TW_0075', name: '중문해수욕장 해양관측부이', stationType: 'marine', lat: 33.2345, lng: 126.40955 },
  ];

  for (const { sourceCode, ...st } of stations) {
    const sourceId = sourceIdOf.get(sourceCode)!;
    await prisma.observationStation.upsert({
      where: { uk_observation_stations_code: { sourceId, stationCode: st.stationCode } },
      update: { name: st.name, stationType: st.stationType, lat: st.lat, lng: st.lng, isActive: true },
      create: { sourceId, ...st },
    });
  }

  // 실관측소로 대체되기 전에 쓰던 가상 관측소를 비활성화한다.
  // SYS-002 는 활성 관측소 중 최근접을 고르는데, 이것들은 좌표가 육지 한복판이라
  // 실제 부이보다 가깝게 잡히는 해변이 생긴다. 그러면 실측 대신 빈 값을 물게 된다.
  const realCodes = stations.map((s) => s.stationCode);
  const disabled = await prisma.observationStation.updateMany({
    where: { stationCode: { notIn: realCodes }, isActive: true },
    data: { isActive: false },
  });

  const kma = stations.filter((s) => s.sourceCode === 'KMA_SEA_OBS').length;
  const khoa = stations.length - kma;
  console.log(
    `  ✓ 관측소 ${stations.length}건 (기상청 ${kma} / 국립해양조사원 ${khoa})` +
      (disabled.count > 0 ? `, 가상 관측소 ${disabled.count}건 비활성화` : ''),
  );
}

async function main() {
  console.log('JellySafe 시드 시작...');
  await seedAdmin();
  await seedTestUser();
  await seedBeaches();
  await seedRiskRules();
  await seedRecommendations();
  await seedGuides();
  await seedNotificationTemplates();
  await seedDataSources();
  await seedObservationStations();
  console.log('시드 완료.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
