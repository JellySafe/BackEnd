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

type Rule = {
  ruleCode: string;
  ruleCategory: string;
  ruleName: string;
  score?: number;
  minRiskLevel?: string;
  conditionJson?: unknown;
};

/**
 * v1 — 최초 점수표 (03_Data_AI 기획 초안, 데이터 검증 전 값).
 *
 * **지우지 않는다.** 롤백 경로이자 이력이다. RISK_RULE_VERSION=v1 로 되돌릴 수 있어야 한다.
 * 백테스트 결과 이 표는 고밀도 출현 26주 중 3주만 '위험'으로 잡았다(재현율 11.5%, F1 0.20).
 * 자세한 내용은 docs/backtest.md, docs/risk-rules-v2.md 참조.
 */
const RULES_V1: Rule[] = [
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

/**
 * v2 — 백테스트 기반 개정 점수표 (2026-07-14).
 *
 * 근거: `scripts/backtest-risk.ts` — 국립수산과학원 주간보고 68건(2024-05~2026-07)을 정답으로,
 *       평가 단위 = 주 × 시군구 = 136 (고밀도 26 / 저밀도 39 / 없음 71).
 *       결정 과정과 한계는 **`docs/risk-rules-v2.md` 에 전부 적어 두었다. 그걸 먼저 읽어라.**
 *
 * 요약 성능 (in-sample, 136 표본):
 *   AUC 0.783 → **0.875** / danger+ F1 0.20 → **0.65** / 고밀도인데 '안전'이라 답한 주 9건 → **4건**
 *
 * ⚠️ 두 가지를 **반드시** 알고 만져라.
 *
 *  1. **단계 구간(56/76)은 이 표로 못 바꾼다.** `src/shared/kernel/risk-level.ts` 의
 *     `riskLevelFromScore` 에 하드코딩돼 있고, 아래 `level_threshold` 행은 엔진이 읽지도 않는다
 *     (rule-config.kysely-query 는 score / min_risk_level 만 select 한다). 표시용 문서일 뿐이다.
 *     → **점수를 고정된 구간에 맞춰 배치했다.** 구간을 옮기면 아래 값도 다시 잡아야 한다.
 *
 *  2. `condition_json` 도 엔진이 읽지 않는다. 실제 임계값은 `risk-assessment.ts` 의 `THRESHOLDS` 다.
 *     v1 의 condition_json 은 코드와 **어긋나 있었다**(delta_c 1.5 vs 실제 2.0, threshold_c 24 vs 실제 25,
 *     angle_tolerance 45 vs 실제 60). 관리자 화면이 거짓말을 하고 있었다는 뜻이다.
 *     → v2 에서는 **코드의 실제 값과 일치시켰다.** 코드를 바꾸면 여기도 같이 바꿔라.
 */
const RULES_V2: Rule[] = [
  // ─────────────────────────────────────────────────────────── 위험 변수 (risk_variable)
  // NEARBY_ALERT 15 → 40.
  //   리프트 12.69(고밀도 주 69.2% 발화 vs 그 외 5.5%), 단일 룰 AUC 0.819, p<0.001.
  //   **8개 룰 중 유일하게 압도적인 신호인데 +15 로 과소평가돼 있었다.** 점수표에서 NEARBY 를 빼면
  //   AUC 가 0.783 → 0.649 로 주저앉는다 — 나머지 신호는 사실상 이 룰 하나다.
  //   왜 40 이고 45+ 가 아닌가: 45 이상이면 severe(76+) 가 폭발한다(백테스트 E-2b).
  //     NEARBY 40 → severe 5건(3.7%) / 45 → 14건(10.3%) / 55 → 18건(13.2%).
  //   severe 는 대응 권고상 "구역 폐쇄 검토 / 입수 통제" 다. 같은 기간 NIFS 자신이 특보를 낸 건
  //   136 단위 중 6건(4.4%)뿐이다. 3.7% 는 그 눈금과 맞고, 10% 는 아무도 안 믿는다.
  //   대가: NIFS 속보 **하나만으로는 danger 에 못 간다**(40+취약도5 = 45 = 주의).
  //         danger 는 "NIFS 속보 + 그 해변의 수온 상승"을 요구한다. danger+ 재현율 57.7% 로,
  //         무지성 베이스라인(지난주 보고서 복사, 69.2%)보다 낮다. 이건 고정 구간이 강요한 대가다.
  //         (구간을 danger 45 로 내리면 재현율 69.2% / 오경보 0% 로 베이스라인과 같아진다 — risk-rules-v2.md 참조)
  { ruleCode: 'NEARBY_ALERT', ruleCategory: 'risk_variable', ruleName: '인근 해역 해파리 속보', score: 40, conditionJson: { radius_km: 30, window_days: 7, fallback: 'region_match_when_no_coords' } },

  // TEMP_UP 10 → 15. 리프트 1.93 (고밀도 80.8% / 그 외 41.8%), 단일 AUC 0.695, p<0.001.
  //   NEARBY 다음으로 유의한 유일한 신호. 해변마다 최근접 부이가 달라 **해변별 변별력의 실질적 원천**이다
  //   (NEARBY·PAST·취약도는 시군구/상수라 해변을 가르지 못한다).
  { ruleCode: 'TEMP_UP', ruleCategory: 'risk_variable', ruleName: '최근 3일 수온 상승', score: 15, conditionJson: { window_days: 3, rise_delta_c: 2.0, or_abs_temp_c: 26.0 } },

  // TEMP_7D_AVG 5 → 10. 리프트 1.86 (69.2% / 37.3%), 단일 AUC 0.660, p=0.003.
  { ruleCode: 'TEMP_7D_AVG', ruleCategory: 'risk_variable', ruleName: '최근 7일 평균 수온 높음', score: 10, conditionJson: { window_days: 7, threshold_c: 25.0 } },

  // PAST_OCCURRENCE 15 → 5. 리프트 1.28, p=0.31 — **유의하지 않다.** +15 는 과대평가였다.
  //   게다가 구조적으로 불리하다: 데이터가 2024-05 부터라 2024년 주간에는 '과거 연도'가 아예 없어
  //   항상 0 이었다(실질적으로 2025~2026 구간에서만 평가됨). 0 으로 지우지 않는 이유는
  //   계절성 자체는 도메인 상식이고, 5 점이면 단계를 뒤집지 못하는 보조 근거로만 작동하기 때문이다.
  { ruleCode: 'PAST_OCCURRENCE', ruleCategory: 'risk_variable', ruleName: '과거 동일 시기 출현 이력', score: 5, conditionJson: { season_window_days: 14, min_age_years: 1 } },

  // ★ WAVE_HIGH 10 → 5 (제거하지 않는다).
  //   백테스트가 잰 것: 리프트 0.67 (고밀도 주에 **오히려 덜** 켜졌다), p=0.48 → 개체군 밀도 예측력 없음.
  //   그런데 이 룰의 원래 취지는 밀도 예측이 아니라 **해안 노출 위험**(거친 바다가 해파리를 물가로 밀어
  //   붙여 쏘임이 는다)이다. 정답이 '시군구 주간 출현률'이라 그 가설은 **이 데이터로 검증 자체가 불가능**하다.
  //   0.67 을 "파고는 무의미하다"로 읽는 건 과잉 해석이다.
  //   그래서 "빼야 하는가"를 절제 실험으로 직접 쟀다(백테스트 E-1, 16개 조합 + 짝지은 부트스트랩 3000회):
  //     · danger 단계 성능: 파고·풍향을 0~15 어디에 두든 **완전히 동일**하다.
  //       (재현율 57.7% / 오경보율 0% / F1 0.65 — Δ재현율 95% CI [0.0%, 0.0%], Δ오경보율 CI [0.0%, 0.0%])
  //       → 빼도 얻는 게 없고, 남겨도 잃는 게 없다. **데이터는 이 둘을 구별하지 못한다.**
  //     · caution 단계에서는 남기는 쪽이 낫다: 고밀도 주인데 '안전'이라 답한 건수가 6건 → **4건**으로 준다.
  //       대가는 출현 없는 주의 caution 오경보 7.0% → 14.1% (5건 → 10건 / 71). caution 은 '모니터링 강화'라
  //       공개 경보가 아니다. 놓침 2건과 caution 헛경보 5건이면 안전 서비스에선 남기는 쪽이 맞다.
  //     · AUC 0.868 → 0.875 (ΔAUC 95% CI [-0.010, +0.025] — 0 을 포함하니 개선을 주장하지 않는다).
  //   왜 하필 5 인가 (10 이 아니라):
  //     10 이면 관측만으로 도달 가능한 최대가 65점 = **danger** 가 된다. 신호가 없다고 측정된 룰들로
  //     해파리 근거 0인 날에 '위험'을 선언하는 경로가 열린다. 5 면 관측만으로는 최대 55점 = 주의 천장이다.
  //     → **5 는 구조 제약을 지키면서 caution 도달률을 최대로 끌어올리는 유일한 값이다.**
  //   그리고 실용적 이유: 파고·풍향은 기상청 해상예보가 24h/72h 를 **재평가하는 유일한 입구**다
  //   (risk-horizon.ts FORECAST_BACKED_CODES). 0 으로 만들면 예보 연동이 통째로 죽는다.
  { ruleCode: 'WAVE_HIGH', ruleCategory: 'risk_variable', ruleName: '파고 높음', score: 5, conditionJson: { threshold_m: 1.5 } },

  // ★ WIND_INFLOW 10 → 5 (제거하지 않는다). 위 WAVE_HIGH 와 완전히 같은 논거.
  //   백테스트: 리프트 0.93, p=0.77 — 무신호. 다만 **해변 방위각(facing_direction)을 쓰는 유일한 룰**이라
  //   이걸 빼면 해변별 변별력의 축이 '최근접 부이 수온' 하나만 남는다.
  //   (BEACH_VULNERABILITY 는 해변별 취약도 값을 실제로 쓰지 않는다 — 아래 주석 참조.)
  { ruleCode: 'WIND_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 풍향', score: 5, conditionJson: { angle_tolerance: 60, min_wind_speed_ms: 5.0 } },

  // CURRENT_INFLOW 10 → 5. **검증 불가 + 센서 배치 인공물 제거.**
  //   기상청은 유향·유속을 관측하지 않고 국립해양조사원(중문 TW_0075)은 과거 조회 API 가 없다
  //   → 백테스트 전 기간 100% 결측이라 신호가 있는지 없는지 **측정 자체를 못 했다.**
  //
  //   처음엔 "근거 없이 올리지도 내리지도 않는다"며 10 으로 뒀는데, 운영에 올리자마자 문제가 터졌다.
  //   제주 해역에서 유향·유속을 재는 부이는 중문 앞바다 하나뿐이고, 그 유향이 중문의 방위각과
  //   맞아떨어져 **이 룰이 켜지는 해변은 사실상 중문 하나뿐**이다(같은 부이를 쓰는 화순조차
  //   방위각이 달라 안 켜진다). 그 결과:
  //
  //     중문 severe 80점 (해파리 속보 1건)  ← '입수 통제'
  //     협재 danger 70점 (해파리 속보 3건)
  //
  //   해파리 근거가 더 적은 해변이 **센서가 하나 더 있다는 이유로** 더 위험하다고 나온다.
  //   이건 위험 신호가 아니라 관측망 배치의 인공물이다.
  //
  //   검증 안 된 다른 관측 룰(WAVE_HIGH, WIND_INFLOW)은 5 로 낮췄으면서 이것만 10 으로 두는 것도
  //   일관성이 없다. 인식론적 지위가 같다 — 셋 다 "신호가 있는지 모른다".
  //   같은 5 로 맞춘다. 실시간 유속 데이터가 쌓여 검증 가능해지면 그때 재평가한다.
  { ruleCode: 'CURRENT_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 해류', score: 5, conditionJson: { angle_tolerance: 60, min_current_speed_ms: 0.3 } },

  // BEACH_VULNERABILITY 5 유지. **검증 불가라 유지한다.**
  //   정답이 시군구 단위라 해변 간 차이를 검증할 방법이 없다(백테스트 한계 1번).
  //   ⚠️ 별개로 알아둘 것: 엔진은 `beaches.vulnerability_score`(5~20)를 **점수에 쓰지 않는다.**
  //      risk-assessment.ts 는 그 값이 0 보다 큰지만 보고 이 룰 점수(=5)를 통째로 더한다.
  //      즉 12개 해변 전부에 붙는 **상수 오프셋**이고, 해변을 전혀 가르지 못한다. 순위에 영향 없음.
  //      (고치려면 도메인 코드를 바꿔야 한다 — 이번 개정 범위 밖. risk-rules-v2.md 에 제안으로 남겼다.)
  { ruleCode: 'BEACH_VULNERABILITY', ruleCategory: 'risk_variable', ruleName: '해수욕장 취약도', score: 5 },

  // ────────────────────────────────────────────────────── 제보 가중치 (report_weight) — 전부 v1 과 동일
  // **검증 불가라 유지한다.** 서비스가 출시된 적이 없어 과거 시민 제보 데이터가 0건이다.
  // 백테스트는 verifiedReports=[] 로 돌렸다 → 이 5개 룰은 단 한 번도 평가되지 않았다.
  // 근거 없이 값을 흔들면 검증된 룰(NEARBY/TEMP)과의 상대 균형만 망가진다.
  //
  // 참고 — v2 로 바뀐 뒤의 상대 균형은 오히려 **더 말이 된다**:
  //   v1: NEARBY(15) < REPORT_TOXIC(25) < REPORT_STING(40)  … 일주일 묵은 광역 속보가 일반 제보(10)와 비슷했다.
  //   v2: NEARBY(40) = REPORT_STING(40)                     … "지난주 인근 고밀도 확인" ≈ "쏘임 사고 1건" 무게.
  // 또한 독성/쏘임은 점수와 무관하게 min_level 보장이 단계를 끌어올린다(RISK-002) — 점수 균형이 안전망은 아니다.
  { ruleCode: 'REPORT_GENERAL', ruleCategory: 'report_weight', ruleName: '일반 해파리 발견 제보', score: 10 },
  { ruleCode: 'REPORT_MULTIPLE', ruleCategory: 'report_weight', ruleName: '다수 출현 제보', score: 15 },
  { ruleCode: 'REPORT_TOXIC', ruleCategory: 'report_weight', ruleName: '독성 해파리 의심 제보', score: 25 },
  { ruleCode: 'REPORT_TOXIC_MULTIPLE', ruleCategory: 'report_weight', ruleName: '독성 의심 + 다수 출현 제보', score: 35 },
  { ruleCode: 'REPORT_STING', ruleCategory: 'report_weight', ruleName: '쏘임 사고 제보', score: 40 },

  // ────────────────────────────────────────────── 위험 단계 구간 (level_threshold) — RISK-001
  // ⚠️ 이 행들은 **표시용**이다. 엔진은 risk-level.ts 의 하드코딩 값을 쓴다(위 헤더 주석 1번).
  //    v1 과 같은 값을 그대로 둔다 — 코드가 그렇게 동작하므로, 다르게 적으면 화면이 거짓말을 하게 된다.
  //    백테스트는 danger 를 45 로 내리면 재현율 57.7% → 69.2%(오경보율 0% 유지, F1 0.65 → 0.71)로
  //    좋아진다고 말한다. 그건 src 수정이 필요해 이번 개정에 넣지 않았다 — risk-rules-v2.md 의 제안 참조.
  //    **구간을 옮기면 이 네 행도 같이 고쳐야 한다.**
  { ruleCode: 'LEVEL_SAFE', ruleCategory: 'level_threshold', ruleName: '안전 0~30', conditionJson: { min: 0, max: 30 } },
  { ruleCode: 'LEVEL_CAUTION', ruleCategory: 'level_threshold', ruleName: '주의 31~55', conditionJson: { min: 31, max: 55 } },
  { ruleCode: 'LEVEL_DANGER', ruleCategory: 'level_threshold', ruleName: '위험 56~75', conditionJson: { min: 56, max: 75 } },
  { ruleCode: 'LEVEL_SEVERE', ruleCategory: 'level_threshold', ruleName: '심각 76~100', conditionJson: { min: 76, max: 100 } },

  // ──────────────────────────────────────────────── 최소 단계 보장 (min_level) — RISK-002
  // **검증 불가라 유지한다.** 제보 데이터가 없어 백테스트로 평가되지 않았다(위와 동일한 이유).
  // ⚠️ 이 행들도 엔진이 읽지 않는다 — deriveMinLevelTriggers 가 도메인 코드에 하드코딩돼 있다.
  //    v2 에서 관측만으로 severe 에 도달하는 경로를 막았으므로(최대 55점), **severe 는 사실상
  //    'NIFS 고밀도 + 강한 관측' 이거나 '독성+쏘임 제보' 로만 뜬다.** 이 보장 룰의 중요도가 오히려 커졌다.
  { ruleCode: 'MIN_TOXIC_1', ruleCategory: 'min_level', ruleName: '독성 의심 1건 → 최소 주의', minRiskLevel: 'caution' },
  { ruleCode: 'MIN_TOXIC_HIGH', ruleCategory: 'min_level', ruleName: '독성 의심 + 신뢰도 높음 → 최소 위험', minRiskLevel: 'danger', conditionJson: { confidence_gte: 0.8 } },
  { ruleCode: 'MIN_TOXIC_STING', ruleCategory: 'min_level', ruleName: '독성 의심 + 쏘임 → 최소 심각', minRiskLevel: 'severe' },
];

/**
 * 위험도 룰 점수표.
 *
 * 버전을 **여러 개 나란히** 심는다. 애플리케이션은 `RISK_RULE_VERSION` 환경변수로 고른다
 * (AppConfig.riskRuleVersion, 기본 'v1'). v2 를 쓰려면 `RISK_RULE_VERSION=v2` 를 넣어라.
 * v1 을 지우지 않으므로 환경변수 한 줄로 즉시 롤백된다.
 */
async function seedRiskRules() {
  const versions: Array<{ version: string; rules: Rule[] }> = [
    { version: 'v1', rules: RULES_V1 },
    { version: 'v2', rules: RULES_V2 },
  ];

  for (const { version, rules } of versions) {
    for (const r of rules) {
      await prisma.riskRuleConfig.upsert({
        where: { uk_risk_rule_configs_code_version: { ruleCode: r.ruleCode, version } },
        // 점수표는 재시드 시 코드값으로 수렴해야 한다(update:{} 면 한번 심은 값이 영원히 고정된다).
        // v2 를 튜닝해 다시 심을 때 DB 가 따라오지 않으면 시드 파일이 거짓말을 하게 된다.
        update: {
          ruleCategory: r.ruleCategory,
          ruleName: r.ruleName,
          score: r.score ?? null,
          minRiskLevel: r.minRiskLevel ?? null,
          conditionJson: (r.conditionJson ?? undefined) as never,
          active: true,
        },
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
  console.log(`    → 적용 버전은 RISK_RULE_VERSION 환경변수로 고른다 (기본 v1, 백테스트 권장 v2)`);
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
