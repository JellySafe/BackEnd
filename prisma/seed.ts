import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * 초기 시드 데이터.
 *   - 관리자 계정 1 (admin@jellysafe.local / admin1234)
 *   - MVP 1순위 해변 5곳 (협재/함덕/이호테우/중문/표선)
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

async function seedBeaches() {
  const beaches = [
    { name: '협재해수욕장', region: '제주시', lat: 33.3941, lng: 126.2396, facingDirection: 315, priority: 1, vulnerabilityScore: 15 },
    { name: '함덕해수욕장', region: '제주시', lat: 33.5432, lng: 126.6698, facingDirection: 0, priority: 2, vulnerabilityScore: 20 },
    { name: '이호테우해수욕장', region: '제주시', lat: 33.4986, lng: 126.4525, facingDirection: 340, priority: 3, vulnerabilityScore: 10 },
    { name: '중문색달해수욕장', region: '서귀포시', lat: 33.2447, lng: 126.4103, facingDirection: 180, priority: 4, vulnerabilityScore: 10 },
    { name: '표선해수욕장', region: '서귀포시', lat: 33.3262, lng: 126.8339, facingDirection: 135, priority: 5, vulnerabilityScore: 5 },
  ];
  for (const b of beaches) {
    await prisma.beach.upsert({ where: { name: b.name }, update: {}, create: b });
  }
  console.log(`  ✓ 해변 ${beaches.length}곳`);
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
    { sourceCode: 'NIFS_JELLYFISH', name: '국립수산과학원 해파리 출현/속보', provider: '국립수산과학원', sourceType: 'jellyfish', isSample: true, syncIntervalMinutes: 60 },
    { sourceCode: 'KHOA_MARINE', name: '해양수산부 해양 관측 (수온/파고/유향)', provider: '국립해양조사원', sourceType: 'marine', isSample: true, syncIntervalMinutes: 30 },
    { sourceCode: 'KMA_WEATHER', name: '기상청 기상 관측 (풍향/풍속/기온)', provider: '기상청', sourceType: 'weather', isSample: true, syncIntervalMinutes: 30 },
    { sourceCode: 'BEACH_MASTER', name: '해수욕장 위치 마스터', provider: '제주특별자치도', sourceType: 'beach', isSample: true },
  ];
  for (const s of sources) {
    await prisma.dataSource.upsert({ where: { sourceCode: s.sourceCode }, update: {}, create: s });
  }
  console.log(`  ✓ 데이터 소스 ${sources.length}건`);
}

async function main() {
  console.log('JellySafe 시드 시작...');
  await seedAdmin();
  await seedBeaches();
  await seedRiskRules();
  await seedRecommendations();
  await seedGuides();
  await seedNotificationTemplates();
  await seedDataSources();
  console.log('시드 완료.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
