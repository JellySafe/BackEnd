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
 *   - 해파리 종 정보 14종 (도감 — 사진/학명/독성 등급. 출처: 국립수산과학원)
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
  // v3 부터 도메인이 밀도별 코드로 발화한다. v1 은 밀도 무구분(+15)이었으므로 세 코드 모두 15.
  // (없어도 DEFAULT_RULE_SCORES 폴백이 15 라 결과는 같지만, 관리자 화면·롤백 명세를 위해 명시한다.)
  { ruleCode: 'NEARBY_ALERT_HIGH', ruleCategory: 'risk_variable', ruleName: '인근 해역 고밀도 출현 (v1: 밀도 무관 15)', score: 15, conditionJson: { radius_km: 30 } },
  { ruleCode: 'NEARBY_ALERT_MEDIUM', ruleCategory: 'risk_variable', ruleName: '인근 해역 중밀도 출현 (v1: 밀도 무관 15)', score: 15, conditionJson: { radius_km: 30 } },
  { ruleCode: 'NEARBY_ALERT_LOW', ruleCategory: 'risk_variable', ruleName: '인근 해역 저밀도 출현 (v1: 밀도 무관 15)', score: 15, conditionJson: { radius_km: 30 } },
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
  // v3 에서 도메인이 인근 룰을 **밀도별 코드**(NEARBY_ALERT_HIGH/MEDIUM/LOW)로 발화하도록 바뀌었다.
  // v2 는 밀도를 가리지 않았으므로, 롤백(RISK_RULE_VERSION=v2) 시 **세 코드 모두 40** 으로 둬야
  // 옛 v2 동작(밀도 무관 +40)이 그대로 재현된다. 이 세 행이 없으면 폴백(15)이 걸려 v2 가 거짓 롤백된다.
  { ruleCode: 'NEARBY_ALERT_HIGH', ruleCategory: 'risk_variable', ruleName: '인근 해역 고밀도 출현 (v2: 밀도 무관 40)', score: 40, conditionJson: { radius_km: 30, window_days: 7, note: 'v2 는 밀도 무구분' } },
  { ruleCode: 'NEARBY_ALERT_MEDIUM', ruleCategory: 'risk_variable', ruleName: '인근 해역 중밀도 출현 (v2: 밀도 무관 40)', score: 40, conditionJson: { radius_km: 30, window_days: 7, note: 'v2 는 밀도 무구분' } },
  { ruleCode: 'NEARBY_ALERT_LOW', ruleCategory: 'risk_variable', ruleName: '인근 해역 저밀도 출현 (v2: 밀도 무관 40)', score: 40, conditionJson: { radius_km: 30, window_days: 7, note: 'v2 는 밀도 무구분' } },

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
  // v2: danger 컷오프 56 → 45. 백테스트에서 56 은 고밀도 출현 주의 11.5% 만 잡았다(재현율).
  //     45 로 내리면 재현율 69.2% 로 오르는데 오경보율은 0.0% 그대로다. 놓침만 준다.
  //     ⚠️ 이 구간은 엔진이 읽지 않는다(risk-level.ts 에 하드코딩). 화면 표시용이라
  //        코드와 어긋나면 관리자 화면이 거짓말을 한다. 반드시 함께 맞출 것.
  { ruleCode: 'LEVEL_CAUTION', ruleCategory: 'level_threshold', ruleName: '주의 31~44', conditionJson: { min: 31, max: 44 } },
  { ruleCode: 'LEVEL_DANGER', ruleCategory: 'level_threshold', ruleName: '위험 45~75', conditionJson: { min: 45, max: 75 } },
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
 * v3 — 밀도 기반 인근 출현 (2026-07-15).
 *
 * 근거: `scripts/backtest-risk.ts` 재실행 — 같은 정답(NIFS 주간보고 68건, 주×시군구 136단위).
 *       결정 과정·한계는 **`docs/risk-rules-v3.md` 를 먼저 읽어라.**
 *
 * ── 무엇이 바뀌었나 ──────────────────────────────────────────────────────────────────
 * v2 의 `NEARBY_ALERT` 는 인근 **경보성 출현 건수**가 1건이라도 있으면 밀도와 무관하게 +40 을 줬다.
 * 그 '건수'는 위험의 강도가 아니라 **NIFS 주간보고에 그 시군구가 몇 종으로 적혔는가**의 부산물이라
 * (종 × 시군구마다 한 행), 저밀도 1종인 서귀포시가 고밀도 2종인 제주시와 같은 +40 을 받았다.
 * → 운영에서 제주 12개 해변이 **전부 danger**. "어느 해변이 안전한가"에 답할 수 없었다.
 *
 * v3 은 건수를 버리고 **창 안 최고 밀도**로 등급을 매긴다(도메인 NEARBY_ALERT_HIGH/LOW).
 *   · 고밀도 40 (v2 의 NEARBY_ALERT 와 같은 무게) / 저밀도 5.
 *   · NIFS 특보 유무와 무관하게 계상한다(관측 사실을 행정 절차가 검열하지 않는다).
 *   · 저밀도 지역이 '안전'으로 침묵하지 않도록 **MIN_NEARBY_1** 이 최소 '주의'를 보장한다(RISK-002).
 *
 * ── 백테스트 요약 (in-sample, 136 표본. v2 배포중 → v3) ──────────────────────────────
 *   AUC             0.825 → 0.886       (Δ CI[+0.020,+0.111], 0 불포함)
 *   danger+ 재현율   88.5% → 73.1%       (건수 방식은 저밀도까지 danger 로 올려 '재현율'이 부풀어 있었다)
 *   danger+ 오경보율  14.1% → 2.8%
 *   danger+ 정밀도    41.1% → 70.4%
 *   danger 판정 비율  41.2% → 19.9%      (성수기 59.7% → 37.5%)  ← "전 해변 빨강" 이 풀렸다
 *   저밀도→danger    59.0% → 15.4%
 *   고밀도 vs 저밀도 AUC 0.704 → 0.827   ← 밀도가 실제로 갈린다
 *   고밀도인데 '안전'  2건 → 2건 (유지)
 *
 * ── 컷오프 ───────────────────────────────────────────────────────────────────────────
 * danger=45 를 **유지**한다(v2 개정에서 이미 56→45 로 내려 배포됨). 밀도 반영 후 다시 재봤고,
 * 45 가 F2·변별력 균형에서 최적이었다(56 은 재현율 73.1%→57.7% 로 손해, 변별력 이득 없음).
 * → risk-level.ts 를 바꿀 필요가 없다. LEVEL_* 행도 v2 와 동일(45/76).
 *
 * ⚠️ v2 헤더 주석의 제약이 그대로 적용된다: 단계 구간·condition_json·min_level 은 엔진이 안 읽는다.
 *    이 표는 **점수**만 데이터다. NEARBY_ALERT_* 세 코드는 도메인이 밀도로 발화시킨다.
 */
const RULES_V3: Rule[] = [
  // ───────────────────────────────────────── 인근 출현 — v3 의 핵심. 건수 → 밀도.
  // v2 의 NEARBY_ALERT(단일, +40)를 밀도별 3코드로 쪼갠다. 도메인(risk-assessment.ts)이
  // 창 안 최고 밀도를 골라 대응 코드를 발화시킨다. 건수는 점수에 쓰지 않는다.
  //   고밀도 40: v2 의 무게를 그대로 물려받는다. NIFS 속보 하나만으로는 danger(45) 에 못 가고
  //             (40+취약도5=45? → 취약도는 엔진이 상수로 5를 더하므로 실제로는 45=danger 경계).
  //             ※ 백테스트 구조점검: 고밀도+취약도 = 45 = danger 경계. NIFS 고밀도 단독으로 danger 가능.
  //               v2 와 동일한 성질이다(v2 도 40+5=45). 대신 저밀도는 여기 못 온다.
  //   중밀도 15: NIFS 주간보고엔 없는 등급(고/저 2단계)이나 다른 수집기(제보·mock)가 넣을 수 있어
  //             사다리를 비워 두지 않는다. 고와 저의 중간값. **검증된 값이 아니다**(표본에 없음).
  //   저밀도 5:  단독으로는 어떤 단계도 못 만든다(5+취약도5=10=안전). 대신 MIN_NEARBY_1 이 '주의'를 깐다.
  //             백테스트에서 저밀도 점수를 0~20 으로 스윕했고 5 가 danger 재현율을 손해 없이 유지하면서
  //             저밀도→danger 비율을 15.4% 로 낮게 유지하는 값이었다(docs/risk-rules-v3.md §2).
  { ruleCode: 'NEARBY_ALERT_HIGH', ruleCategory: 'risk_variable', ruleName: '인근 해역 고밀도 출현', score: 40, conditionJson: { radius_km: 30, window_days: 7, density: 'high', fallback: 'region_match_when_no_coords' } },
  { ruleCode: 'NEARBY_ALERT_MEDIUM', ruleCategory: 'risk_variable', ruleName: '인근 해역 중밀도 출현', score: 15, conditionJson: { radius_km: 30, window_days: 7, density: 'medium', note: 'NIFS 주간보고엔 없는 등급 — 미검증' } },
  { ruleCode: 'NEARBY_ALERT_LOW', ruleCategory: 'risk_variable', ruleName: '인근 해역 저밀도 출현', score: 5, conditionJson: { radius_km: 30, window_days: 7, density: 'low' } },
  // v2 의 단일 NEARBY_ALERT 는 **비활성**으로 남긴다(도메인이 더 이상 이 코드를 발화하지 않는다).
  // 지우지 않는 이유: 과거 risk_factors 행이 이 코드를 참조하고, 관리자 화면 룰 목록의 이력이다.
  { ruleCode: 'NEARBY_ALERT', ruleCategory: 'risk_variable', ruleName: '인근 해역 해파리 속보 (v3: NEARBY_ALERT_* 로 대체)', score: 40, conditionJson: { deprecated: true, replaced_by: ['NEARBY_ALERT_HIGH', 'NEARBY_ALERT_MEDIUM', 'NEARBY_ALERT_LOW'] } },

  // ───────────────────────────────────────── 관측 룰 — v2 와 동일(재검증했고 안 바꿨다).
  { ruleCode: 'TEMP_UP', ruleCategory: 'risk_variable', ruleName: '최근 3일 수온 상승', score: 15, conditionJson: { window_days: 3, rise_delta_c: 2.0, or_abs_temp_c: 26.0 } },
  { ruleCode: 'TEMP_7D_AVG', ruleCategory: 'risk_variable', ruleName: '최근 7일 평균 수온 높음', score: 10, conditionJson: { window_days: 7, threshold_c: 25.0 } },
  { ruleCode: 'PAST_OCCURRENCE', ruleCategory: 'risk_variable', ruleName: '과거 동일 시기 출현 이력', score: 5, conditionJson: { season_window_days: 14, min_age_years: 1 } },
  { ruleCode: 'WAVE_HIGH', ruleCategory: 'risk_variable', ruleName: '파고 높음', score: 5, conditionJson: { threshold_m: 1.5 } },
  { ruleCode: 'WIND_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 풍향', score: 5, conditionJson: { angle_tolerance: 60, min_wind_speed_ms: 5.0 } },
  { ruleCode: 'CURRENT_INFLOW', ruleCategory: 'risk_variable', ruleName: '해변 방향 유입 해류', score: 5, conditionJson: { angle_tolerance: 60, min_current_speed_ms: 0.3 } },
  { ruleCode: 'BEACH_VULNERABILITY', ruleCategory: 'risk_variable', ruleName: '해수욕장 취약도', score: 5 },

  // ───────────────────────────────────────── 제보 가중치 — v2 와 동일(검증 불가).
  { ruleCode: 'REPORT_GENERAL', ruleCategory: 'report_weight', ruleName: '일반 해파리 발견 제보', score: 10 },
  { ruleCode: 'REPORT_MULTIPLE', ruleCategory: 'report_weight', ruleName: '다수 출현 제보', score: 15 },
  { ruleCode: 'REPORT_TOXIC', ruleCategory: 'report_weight', ruleName: '독성 해파리 의심 제보', score: 25 },
  { ruleCode: 'REPORT_TOXIC_MULTIPLE', ruleCategory: 'report_weight', ruleName: '독성 의심 + 다수 출현 제보', score: 35 },
  { ruleCode: 'REPORT_STING', ruleCategory: 'report_weight', ruleName: '쏘임 사고 제보', score: 40 },

  // ───────────────────────────────────────── 단계 구간 — v2 와 동일(45/76). 표시용.
  { ruleCode: 'LEVEL_SAFE', ruleCategory: 'level_threshold', ruleName: '안전 0~30', conditionJson: { min: 0, max: 30 } },
  { ruleCode: 'LEVEL_CAUTION', ruleCategory: 'level_threshold', ruleName: '주의 31~44', conditionJson: { min: 31, max: 44 } },
  { ruleCode: 'LEVEL_DANGER', ruleCategory: 'level_threshold', ruleName: '위험 45~75', conditionJson: { min: 45, max: 75 } },
  { ruleCode: 'LEVEL_SEVERE', ruleCategory: 'level_threshold', ruleName: '심각 76~100', conditionJson: { min: 76, max: 100 } },

  // ───────────────────────────────────────── 최소 단계 보장 (RISK-002).
  // MIN_NEARBY_1 이 v3 에서 새로 추가됐다: 인근에 해파리가 확인되면(밀도 무관) 최소 '주의'.
  //   저밀도 지역이 점수가 낮아 '안전' 으로 침묵하는 것을 막는다(위 헤더 참조). 엔진은 이 코드를
  //   deriveNearbyMinTriggers 로 하드코딩 적용한다 — 이 행은 관리자 화면 표시용이다.
  { ruleCode: 'MIN_TOXIC_1', ruleCategory: 'min_level', ruleName: '독성 의심 1건 → 최소 주의', minRiskLevel: 'caution' },
  { ruleCode: 'MIN_TOXIC_HIGH', ruleCategory: 'min_level', ruleName: '독성 의심 + 신뢰도 높음 → 최소 위험', minRiskLevel: 'danger', conditionJson: { confidence_gte: 0.8 } },
  { ruleCode: 'MIN_TOXIC_STING', ruleCategory: 'min_level', ruleName: '독성 의심 + 쏘임 → 최소 심각', minRiskLevel: 'severe' },
  { ruleCode: 'MIN_NEARBY_1', ruleCategory: 'min_level', ruleName: '인근 출현 확인 → 최소 주의', minRiskLevel: 'caution', conditionJson: { any_density: true, window_days: 7 } },
];

/**
 * 위험도 룰 점수표.
 *
 * 버전을 **여러 개 나란히** 심는다. 애플리케이션은 `RISK_RULE_VERSION` 환경변수로 고른다
 * (AppConfig.riskRuleVersion, 기본 'v1'). v3 를 쓰려면 `RISK_RULE_VERSION=v3` 를 넣어라.
 * v1·v2 를 지우지 않으므로 환경변수 한 줄로 즉시 롤백된다.
 */
async function seedRiskRules() {
  const versions: Array<{ version: string; rules: Rule[] }> = [
    { version: 'v1', rules: RULES_V1 },
    { version: 'v2', rules: RULES_V2 },
    { version: 'v3', rules: RULES_V3 },
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
  console.log(`    → 적용 버전은 RISK_RULE_VERSION 환경변수로 고른다 (기본 v1, 운영 권장 v3)`);
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

/**
 * 해파리 쏘임 응급처치 문구 (G-006).
 *
 * ⚠️ **응급처치 정보는 틀리면 사람이 다친다.** 임의로 쓰거나 요약하지 마라.
 *
 * 출처: 국립수산과학원 「해파리 응급대처법」
 *       https://www.nifs.go.kr/portal/pcon0000066/systA/actionConts.do (2026-07-14 확인)
 *
 * 왜 이 출처인가 — 국립수산과학원에는 응급처치 자료가 **두 개 있고 서로 충돌한다.**
 *
 *   · 게시판 첨부 PDF(구 자료): 종별로 **알코올·식초·암모니아수**로 닦으라고 안내한다.
 *   · 현행 포털 페이지: 종 구분 없이 **바닷물·생리식염수** 세척 + **온찜질 45℃**,
 *     그리고 **수돗물 금지**(독침 발사가 증가한다)를 명시한다.
 *
 * 알코올·식초는 자포(독침) 발사를 오히려 촉진할 수 있다는 것이 최근 지침의 방향이다.
 * 옛 PDF 를 그대로 넣으면 **현행 지침과 반대되는 응급처치를 안내하게 된다.**
 * 그래서 **현행 포털 페이지만** 채택했다. 종별 안내는 넣지 않는다.
 *
 * 공공데이터포털에는 응급처치 데이터셋이 없다(해파리 출현 정보와 속보 조치사항만 있다).
 * 즉 이 문구는 API 로 자동 갱신되지 않는다 — 국립수산과학원이 지침을 바꾸면
 * **사람이 확인해서 여기를 고쳐야 한다.** 관리자 화면에서 수정할 수 있게 static_guides 에 둔다.
 */
const FIRST_AID_BODY = [
  '해파리에 쏘이면 즉시 물 밖으로 나오세요.',
  '',
  '[약하게 쏘인 경우]',
  '1. 쏘인 부위에 남아있는 촉수를 바닷물 또는 생리식염수로 신속히 제거하고 충분히 세척합니다.',
  '2. 통증이 남아있으면 온찜질(45℃ 내외)로 통증을 완화합니다.',
  '3. 상처 부위가 충분히 진정되었는지 확인합니다.',
  '',
  '[심각한 증상이 나타나는 경우]',
  '호흡 곤란 · 의식 불명 · 전신 통증 등의 증상을 보이면',
  '즉시 119에 신고하고 의료진의 도움을 요청하세요(필요시 심폐소생술).',
  '이후 병원으로 이송해 응급치료를 받아야 합니다.',
  '',
  '[반드시 지킬 것]',
  '· 수돗물로 씻지 마세요. 해파리 독침 발사가 증가해 피해가 커집니다.',
  '· 물에 들어갈 때는 피부 노출을 최소화하세요.',
  '',
  '출처: 국립수산과학원 「해파리 응급대처법」 (2026-07-14 확인)',
].join('\n');

async function seedGuides() {
  const guides = [
    { guideCode: 'DISCLAIMER_PUBLIC', targetType: 'public', title: '위험도 참고 정보 안내', body: 'JellySafe 위험도는 참고 정보이며, 현장 안전요원 및 운영기관의 최종 안내가 우선합니다.', displayOrder: 1 },
    { guideCode: 'DISCLAIMER_ADMIN', targetType: 'admin', title: '운영 판단 안내', body: 'AI 판별 결과는 관리자 확인 전 확정 데이터가 아닙니다. 운영기관 기준에 따라 최종 조치하세요.', displayOrder: 1 },
    { guideCode: 'SAFETY_SEVERE', targetType: 'public', riskLevel: 'severe', title: '심각 단계 안전 안내', body: '입수를 자제하고 대체 해변 이용을 권장합니다. 쏘임 시 즉시 안전요원에게 알리세요.', displayOrder: 2 },
    { guideCode: 'FIRST_AID', targetType: 'public', title: '해파리 접촉피해 응급대처법', body: FIRST_AID_BODY, displayOrder: 3 },
  ];
  for (const g of guides) {
    // 응급처치 문구는 update 에도 넣는다. 지침이 바뀌었는데 재시드해도 옛 문구가 남아 있으면
    // 사람이 다칠 수 있다(다른 시드와 달리 update:{} 가 아니다).
    const update = g.guideCode === 'FIRST_AID' ? { title: g.title, body: g.body } : {};
    await prisma.staticGuide.upsert({ where: { guideCode: g.guideCode }, update, create: g });
  }
  console.log(`  ✓ 안내/고지 문구 ${guides.length}건 (응급대처법 포함 — 출처: 국립수산과학원)`);
}

/**
 * 해파리 종 정보 (도감, jellyfish_species).
 *
 * 사용자에게 "노무라입깃해파리 출현 중" 이라고만 알려주면 **그게 뭔지 모른다.**
 * 사진·특징·독성 등급이 있어야 "내가 본 게 이거구나" 가 되고, 제보 정확도도 오른다.
 *
 * ## 출처 (전부 국립수산과학원)
 *  · 종 목록·학명·사진 : https://www.nifs.go.kr/portal/me/jelyC/actionJelyFishInfo.do
 *                        사진 = https://www.nifs.go.kr/portal/cmmn/images/jely/j{N}.jpg
 *  · 독성 등급         : 해파리 모니터링 주간보고 (2026-07-09 자)
 *  · 특징/출현시기/증상 : 국립수산과학원 해파리 응급처치 자료 — **6종만** 서술이 있다.
 *
 * ## 채우지 않은 칸은 비워 둔다
 * 나머지 8종은 특징·출현시기 원문이 없다. **지어내지 않고 null 로 둔다.**
 * 독성 등급도 주간보고에 등급이 실린 7종만 채운다 — 나머지는 "무해" 가 아니라 **미공표(null)** 다.
 * (작은부레관해파리·작은상자해파리는 위험한 종으로 알려져 있으나, 기관이 등급을 발표한 문서를
 *  확인하지 못했다. 등급을 추정해 넣으면 기관 발표인 것처럼 보이게 된다 — 대신 특징/증상 원문을 싣는다.)
 *
 * ## 이미지: 링크만 한다
 * 국립수산과학원 종 사진 페이지에는 공공누리 유형 표시가 없다. 우리 서버로 **복제·재호스팅하지 않고**
 * 원본 URL 을 링크하며, 출처(imageSource)를 응답에 함께 실어 화면이 반드시 표시하게 한다.
 * 자체 촬영본이나 라이선스가 명확한 사진이 생기면 imageUrl/imageSource 만 갈아끼우면 된다.
 * (2026-07-15 기준 14개 URL 전부 HTTP 200 image/jpeg 확인)
 *
 * ## ⛔ 종별 응급처치는 넣지 않는다
 * 응급처치 PDF 에는 종별 처치법(노무라 → 알코올, 유령 → 식초 등)도 있지만, 같은 기관의
 * **현행 포털 지침과 정면으로 충돌한다**(현행: 바닷물·생리식염수 세척 + 온찜질 45℃, 수돗물 금지.
 * 알코올·식초 언급 없음 — 자포 발사를 촉진할 수 있다). 응급처치는 static_guides 의 FIRST_AID
 * 하나로만 관리한다(seedGuides 참조). stingSymptom 은 '증상' 설명이지 처치법이 아니다.
 */
const NIFS_IMAGE_BASE = 'https://www.nifs.go.kr/portal/cmmn/images/jely/';
const NIFS_SPECIES_PAGE = 'https://www.nifs.go.kr/portal/me/jelyC/actionJelyFishInfo.do';
const NIFS = '국립수산과학원';

type SpeciesSeed = {
  koreanName: string;
  scientificName: string;
  /** strong(강독성)/mild(약독성)/harmless(무해성). 주간보고 미기재 종은 생략 → null. */
  toxicity?: 'strong' | 'mild' | 'harmless';
  features?: string;
  appearanceSeason?: string;
  stingSymptom?: string;
  /** 종정보 페이지의 이미지 파일명(j{N}.jpg). */
  image: string;
};

const SPECIES: SpeciesSeed[] = [
  {
    koreanName: '두빛보름달해파리',
    scientificName: 'Aurelia limbata',
    toxicity: 'strong', // 주간보고 2026-07-09 강독성
    image: 'j1.jpg',
  },
  { koreanName: '관해파리류', scientificName: 'Apolemia sp.', image: 'j2.jpg' },
  { koreanName: '푸른우산관해파리', scientificName: 'Porpita sp.', image: 'j3.jpg' },
  { koreanName: '오이빗해파리', scientificName: 'Beroe cucumis', image: 'j4.jpg' },
  { koreanName: '무희나선꼬리해파리', scientificName: 'Spirocodon saltatrix', image: 'j5.jpg' },
  {
    koreanName: '기수식용해파리',
    scientificName: 'Rhopilema esculentum',
    toxicity: 'mild', // 주간보고 2026-07-09 약독성
    image: 'j6.jpg',
  },
  {
    koreanName: '보름달물해파리',
    scientificName: 'Aurelia coerulea',
    toxicity: 'mild', // 주간보고 2026-07-09 약독성
    image: 'j7.jpg',
  },
  {
    koreanName: '노무라입깃해파리',
    scientificName: 'Nemopilema nomurai',
    toxicity: 'strong',
    features:
      '대형해파리로 우산의 직경이 150cm, 무게가 100kg 을 넘는다. 우산은 연한 갈색이고, 구완의 촉수는 진한 갈색을 띤다.',
    appearanceSeason:
      '6월말 제주에서 출현, 8월 중순에는 우리나라 전역에서 출현하며 12월 초순까지 서식한다.',
    stingSymptom: '통증과 홍반을 동반한 채찍 모양의 상처',
    image: 'j8.jpg',
  },
  {
    koreanName: '커튼원양해파리',
    scientificName: 'Chrysaora pacifica',
    toxicity: 'strong',
    features:
      '우산은 연한 갈색으로 10cm 미만이고, 우산 중심으로부터 방사형의 진한 갈색 줄무늬가 있다.',
    appearanceSeason: '봄부터 가을까지 남해안에 분포',
    image: 'j9.jpg',
  },
  {
    koreanName: '작은부레관해파리',
    scientificName: 'Physalia physalis',
    // 주간보고 독성 등급표에 없다 → 추정하지 않고 null. 특징/증상 원문으로 위험을 전달한다.
    features:
      '몸 전체가 푸른색이며, 만두 모양의 공기가 들어있는 부레가 물 표면에 떠 있고 부레 아래쪽에는 독성을 지닌 진한 파랑의 촉수가 늘어져 있다.',
    appearanceSeason: '6~8월, 제주도',
    stingSymptom: '심한 통증과 홍반을 동반한 채찍 모양의 붉은 선',
    image: 'j10.jpg',
  },
  {
    koreanName: '야광원양해파리',
    scientificName: 'Pelagia noctiluca',
    toxicity: 'strong',
    features:
      '우산의 크기는 7~8cm 가량이며 우산 위에 울퉁불퉁한 자포낭이 산재. 분홍색이며 우산 가장자리에 여덟 개의 진한 촉수.',
    appearanceSeason: '5~7월, 제주·남해안',
    stingSymptom: '통증, 호흡곤란을 일으킬 수도 있다',
    image: 'j11.jpg',
  },
  {
    koreanName: '유령해파리',
    scientificName: 'Cyanea nozakii',
    // 주간보고는 '유령해파리류' 로 쓴다. 매칭은 speciesNameKey() 가 '류' 를 벗겨 처리한다.
    toxicity: 'strong',
    features:
      '몸체는 연한 우유빛이며, 우산의 크기는 30~50cm. 촉수는 하얀색으로 우산 내부의 잘 발달된 근육 사이에서 수백 개씩 덩어리져 내려온다.',
    appearanceSeason: '7월부터 11월까지 남해안 일대에 분포',
    stingSymptom: '통증',
    image: 'j12.jpg',
  },
  { koreanName: '꽃모자갈퀴손해파리', scientificName: 'Gonionemus vertens', image: 'j13.jpg' },
  {
    koreanName: '작은상자해파리',
    scientificName: 'Carybdea brevipedalia',
    // 응급처치 자료의 '입방해파리'. 주간보고 등급표에 없어 toxicity 는 null.
    features:
      '우산은 입방형이며 크기는 3cm 정도. 이른 아침·저녁 또는 흐린 날에 수표면으로 떠오르며 무리를 지어 출현한다. 투명하여 수중에서 쉽게 찾을 수 없다.',
    appearanceSeason: '7~8월, 남해안 일대',
    stingSymptom: '통증과 함께 채찍 모양 상처, 주변부위가 빨갛게 부어오름',
    image: 'j14.jpg',
  },
];

async function seedSpecies() {
  for (const [i, s] of SPECIES.entries()) {
    // 참조 데이터라 **최신 값이 맞다** → update 에도 전부 넣는다(update:{} 면 한번 심은 값이 영원히 고정된다).
    // 사진 URL 이 깨지거나 기관이 등급을 새로 발표했을 때 재시드로 수렴해야 한다.
    const data = {
      scientificName: s.scientificName,
      toxicity: s.toxicity ?? null,
      features: s.features ?? null,
      appearanceSeason: s.appearanceSeason ?? null,
      stingSymptom: s.stingSymptom ?? null,
      imageUrl: `${NIFS_IMAGE_BASE}${s.image}`,
      imageSource: NIFS, // 이미지가 있으면 출처는 필수다(ck_jellyfish_species_image_source)
      imageSourceUrl: NIFS_SPECIES_PAGE,
      displayOrder: i + 1,
      active: true,
    };
    await prisma.jellyfishSpecies.upsert({
      where: { koreanName: s.koreanName },
      update: data,
      create: { koreanName: s.koreanName, ...data },
    });
  }
  const graded = SPECIES.filter((s) => s.toxicity).length;
  console.log(
    `  ✓ 해파리 종 정보 ${SPECIES.length}종 (독성 등급 ${graded}종 / 미공표 ${SPECIES.length - graded}종, 이미지 출처: ${NIFS})`,
  );
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
  await seedSpecies();
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
