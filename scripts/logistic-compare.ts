/**
 * 로지스틱 회귀 vs 룰 기반 위험도(v3) — 정직한 비교 (JellySafe).
 *
 * 목적: "위험도를 룰 점수표(v3) 대신 로지스틱 회귀로 갈아탈 가치가 있는가?" 에 **실측으로** 답한다.
 *   결정 작업이지 프로덕션 개편이 아니다. 결론이 무엇이든 정직하게 쓴다(회귀가 지면 졌다고).
 *
 * 데이터: **백테스트 스크립트가 이미 만든 결과 덤프**(backtest-result.json)를 그대로 읽는다.
 *   데이터 로딩(NIFS 주간보고 파싱 + 기상청 관측 + 룰 발화값 추출)을 재구현하지 않는다.
 *   그 덤프의 `units` 는 (주 × 시군구) 136단위이고, 각 단위에
 *     - fired         : 발화한 관측 룰 코드(NEARBY 제외) — 과제 D 와 동일하게 시군구 내 해변 합집합
 *     - nearbyDensity : 직전 주간보고 그 시군구의 최고 밀도(none/low/high) — NEARBY_* 룰의 원자료
 *     - beachFired    : 해변별 발화 코드 집합(룰 v3 점수를 해변 max 로 집계할 때 쓴다)
 *     - density       : 정답(none/low/high). 고밀도(high)=danger 이상.
 *   가 들어 있다. 따라서 도메인 코드를 import 할 필요가 없다 — 회귀 피처는 전부 이 덤프에서 나온다.
 *
 * 타깃: **고밀도(danger 이상) 이진 분류** (density==='high'). 룰 v3 의 대표 AUC(0.886, in-sample)와
 *   **같은 타깃**이라 사과 대 사과 비교가 된다.
 *
 * 새 npm 의존성 없음(로지스틱 회귀는 경사하강법으로 직접 구현, L2 릿지 포함).
 *
 * 실행:
 *   1) 먼저 백테스트를 한 번 돌려 덤프를 만든다(캐시가 있으면 수 초):
 *        BACKTEST_NO_FETCH=1 npx ts-node --transpile-only -r tsconfig-paths/register scripts/backtest-risk.ts
 *   2) 이 스크립트:
 *        npx ts-node --transpile-only scripts/logistic-compare.ts
 *   (이 스크립트는 도메인 import 가 없어 tsconfig-paths 도 필요 없다.)
 *
 * 환경변수:
 *   BACKTEST_OUT  덤프 경로 (기본: os.tmpdir()/jellysafe-backtest/backtest-result.json — 백테스트 기본값과 동일)
 */
import { existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// =====================================================================================
// 0) 설정
// =====================================================================================

const DUMP_PATH =
  process.env.BACKTEST_OUT ?? path.join(os.tmpdir(), 'jellysafe-backtest', 'backtest-result.json');

/** 회귀 피처 = 룰이 이미 뽑는 발화값. CURRENT_INFLOW(전 기간 결측)·BEACH_VULNERABILITY(상수=절편)는 제외. */
const OBS_RULES = ['TEMP_UP', 'TEMP_7D_AVG', 'WAVE_HIGH', 'WIND_INFLOW', 'PAST_OCCURRENCE'] as const;
/** 전체 피처 순서(계수 표와 일치). NEARBY 는 밀도 이진 2개로 편다. */
const FEATURES = ['NEARBY_HIGH', 'NEARBY_LOW', ...OBS_RULES] as const;
type Feature = (typeof FEATURES)[number];

/**
 * 배포된 룰 v3 점수표(= backtest-risk.ts 후보 (i) v3+최소주의 = dens(40,5,'any') + V2 관측점수).
 * 프로덕션 값은 seed.ts RULES_V3(DB)에 있고 코드 상수 DEFAULT_RULE_SCORES 는 v1 폴백이라 다르다.
 * seed.ts 가 바뀌면 이 표도 고쳐야 한다(backtest-risk.ts 상단 주석과 같은 규약).
 */
const V3_W: Record<string, number> = {
  NEARBY_ALERT_HIGH: 40,
  NEARBY_ALERT_LOW: 5,
  TEMP_UP: 15,
  TEMP_7D_AVG: 10,
  PAST_OCCURRENCE: 5,
  WAVE_HIGH: 5,
  WIND_INFLOW: 5,
  CURRENT_INFLOW: 5,
  BEACH_VULNERABILITY: 5,
};
const V3_DANGER_CUT = 45; // risk-level.ts riskLevelFromScore 현행 배포값

const KFOLDS = 5;
const SEED = 20260715;
const LAMBDAS = [0.0, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0]; // L2 강도 후보
const GD_ITERS = 6000;
const GD_LR = 0.3;
const BOOT_ITERS = 3000;

// =====================================================================================
// 1) 데이터 로드
// =====================================================================================

interface DumpUnit {
  endDay: string;
  month: number;
  region: string;
  density: 'high' | 'low' | 'none';
  fired: string[]; // NEARBY 제외 관측 룰(합집합)
  beachFired: string[][]; // 해변별 관측 발화(NEARBY 제외)
  nearbyDensity: 'high' | 'low' | 'none';
}

interface Sample {
  endDay: string;
  month: number;
  region: string;
  x: number[]; // FEATURES 순서
  y: number; // 1 = 고밀도
  ruleScore: number; // 룰 v3 연속 점수(해변 max) — AUC 비교용
}

function loadSamples(): Sample[] {
  if (!existsSync(DUMP_PATH)) {
    throw new Error(
      `백테스트 덤프가 없다: ${DUMP_PATH}\n` +
        `먼저 실행: BACKTEST_NO_FETCH=1 npx ts-node --transpile-only -r tsconfig-paths/register scripts/backtest-risk.ts`,
    );
  }
  const dump = JSON.parse(readFileSync(DUMP_PATH, 'utf8')) as { units: DumpUnit[] };
  return dump.units.map((u) => {
    const fired = new Set(u.fired);
    const x = FEATURES.map((f) => {
      if (f === 'NEARBY_HIGH') return u.nearbyDensity === 'high' ? 1 : 0;
      if (f === 'NEARBY_LOW') return u.nearbyDensity === 'low' ? 1 : 0;
      return fired.has(f) ? 1 : 0;
    });
    return {
      endDay: u.endDay,
      month: u.month,
      region: u.region,
      x,
      y: u.density === 'high' ? 1 : 0,
      ruleScore: ruleV3Score(u),
    };
  });
}

/** 룰 v3 연속 점수 = 시군구 내 해변 최대(안전 측 집계 — backtest-risk.ts unitScore 와 동일 식). */
function ruleV3Score(u: DumpUnit): number {
  const near =
    u.nearbyDensity === 'high' ? V3_W.NEARBY_ALERT_HIGH : u.nearbyDensity === 'low' ? V3_W.NEARBY_ALERT_LOW : 0;
  let best = 0;
  for (const beach of u.beachFired) {
    let s = near;
    for (const c of beach) s += V3_W[c] ?? 0;
    s = Math.max(0, Math.min(100, Math.round(s)));
    if (s > best) best = s;
  }
  return best;
}

// =====================================================================================
// 2) 지표 (backtest-risk.ts 와 동일 구현 — Mann–Whitney U AUC, 결정적 난수)
// =====================================================================================

function auc(scores: number[], truth: number[]): number {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < scores.length; i += 1) (truth[i] ? pos : neg).push(scores[i]);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let sum = 0;
  for (const p of pos) for (const n of neg) sum += p > n ? 1 : p === n ? 0.5 : 0;
  return sum / (pos.length * neg.length);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function fmt(n: number, d = 3): string {
  return Number.isFinite(n) ? n.toFixed(d) : 'n/a';
}
function pct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'n/a';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================================================
// 3) 로지스틱 회귀 (경사하강법 + L2 릿지). 절편은 정규화하지 않는다.
//    피처는 학습 표본 통계로 표준화(누수 방지). 표준화 계수는 크기 비교가 가능하다.
// =====================================================================================

interface Model {
  w: number[]; // 표준화 공간의 계수(FEATURES 순서)
  b: number;
  mu: number[];
  sigma: number[];
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function fit(X: number[][], y: number[], lambda: number): Model {
  const n = X.length;
  const p = FEATURES.length;
  const mu = new Array(p).fill(0);
  const sigma = new Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += X[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i += 1) v += (X[i][j] - mu[j]) ** 2;
    const std = Math.sqrt(v / n);
    sigma[j] = std > 1e-9 ? std : 1; // 상수 피처는 표준화 안 함(기여 0)
  }
  const Xs = X.map((row) => row.map((v, j) => (v - mu[j]) / sigma[j]));
  const w = new Array(p).fill(0);
  let b = 0;
  for (let it = 0; it < GD_ITERS; it += 1) {
    const gw = new Array(p).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      let z = b;
      for (let j = 0; j < p; j += 1) z += w[j] * Xs[i][j];
      const err = sigmoid(z) - y[i];
      gb += err;
      for (let j = 0; j < p; j += 1) gw[j] += err * Xs[i][j];
    }
    b -= GD_LR * (gb / n);
    for (let j = 0; j < p; j += 1) w[j] -= GD_LR * (gw[j] / n + lambda * w[j]);
  }
  return { w, b, mu, sigma };
}

function predict(m: Model, x: number[]): number {
  let z = m.b;
  for (let j = 0; j < FEATURES.length; j += 1) z += m.w[j] * ((x[j] - m.mu[j]) / m.sigma[j]);
  return sigmoid(z);
}

// 피처 부분집합으로 학습(하이브리드/간소 모델용). mask: 쓸 피처 인덱스.
function fitSubset(samples: Sample[], mask: number[], lambda: number): { w: number[]; b: number; mu: number[]; sigma: number[]; mask: number[] } {
  const X = samples.map((s) => mask.map((j) => s.x[j]));
  const y = samples.map((s) => s.y);
  const n = X.length;
  const p = mask.length;
  const mu = new Array(p).fill(0);
  const sigma = new Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += X[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i += 1) v += (X[i][j] - mu[j]) ** 2;
    const std = Math.sqrt(v / n);
    sigma[j] = std > 1e-9 ? std : 1;
  }
  const Xs = X.map((row) => row.map((v, j) => (v - mu[j]) / sigma[j]));
  const w = new Array(p).fill(0);
  let b = 0;
  for (let it = 0; it < GD_ITERS; it += 1) {
    const gw = new Array(p).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      let z = b;
      for (let j = 0; j < p; j += 1) z += w[j] * Xs[i][j];
      const err = sigmoid(z) - y[i];
      gb += err;
      for (let j = 0; j < p; j += 1) gw[j] += err * Xs[i][j];
    }
    b -= GD_LR * (gb / n);
    for (let j = 0; j < p; j += 1) w[j] -= GD_LR * (gw[j] / n + lambda * w[j]);
  }
  return { w, b, mu, sigma, mask };
}
function predictSubset(m: { w: number[]; b: number; mu: number[]; sigma: number[]; mask: number[] }, x: number[]): number {
  let z = m.b;
  for (let j = 0; j < m.mask.length; j += 1) z += m.w[j] * ((x[m.mask[j]] - m.mu[j]) / m.sigma[j]);
  return sigmoid(z);
}

// =====================================================================================
// 4) 그룹 K-겹 (주 단위로 묶는다 — 같은 주의 두 시군구가 학습/검증으로 갈리지 않게)
//    NEARBY 피처가 '직전 주'를 참조하므로 인접 주는 상관이 있다. 주 블록을 통째로 폴드에 넣어
//    시군구·주 누수를 막는다.
// =====================================================================================

function weekFolds(samples: Sample[], k: number, seed: number): number[] {
  const weeks = [...new Set(samples.map((s) => s.endDay))].sort();
  const rnd = mulberry32(seed);
  // Fisher–Yates 로 주를 섞은 뒤 라운드로빈으로 폴드 배정(폴드 크기 균형).
  const shuffled = weeks.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const foldOfWeek = new Map<string, number>();
  shuffled.forEach((wk, i) => foldOfWeek.set(wk, i % k));
  return samples.map((s) => foldOfWeek.get(s.endDay)!);
}

interface CvResult {
  perFoldLogit: number[];
  perFoldRule: number[];
  oofLogit: number[]; // out-of-fold 예측(로지스틱 확률)
  oofRule: number[]; // out-of-fold 룰 점수(고정이라 = 원 점수)
  oofY: number[];
}

function crossValidate(samples: Sample[], mask: number[], lambda: number, folds: number[]): CvResult {
  const k = Math.max(...folds) + 1;
  const perFoldLogit: number[] = [];
  const perFoldRule: number[] = [];
  const oofLogit = new Array(samples.length).fill(NaN);
  const oofRule = samples.map((s) => s.ruleScore);
  const oofY = samples.map((s) => s.y);
  for (let f = 0; f < k; f += 1) {
    const train = samples.filter((_, i) => folds[i] !== f);
    const valIdx = samples.map((_, i) => i).filter((i) => folds[i] === f);
    const m = fitSubset(train, mask, lambda);
    for (const i of valIdx) oofLogit[i] = predictSubset(m, samples[i].x);
    const vScoresL = valIdx.map((i) => oofLogit[i]);
    const vScoresR = valIdx.map((i) => samples[i].ruleScore);
    const vY = valIdx.map((i) => samples[i].y);
    perFoldLogit.push(auc(vScoresL, vY));
    perFoldRule.push(auc(vScoresR, vY));
  }
  return { perFoldLogit, perFoldRule, oofLogit, oofRule, oofY };
}

/** 짝지은 부트스트랩 — OOF 예측에서 ΔAUC(로지스틱 − 룰)의 95% CI. */
function pairedBootstrapAuc(oofA: number[], oofB: number[], y: number[], iters: number, seed: number): { mean: number; ci: [number, number] } {
  const rnd = mulberry32(seed);
  const n = y.length;
  const diffs: number[] = [];
  for (let it = 0; it < iters; it += 1) {
    const idx: number[] = [];
    for (let i = 0; i < n; i += 1) idx.push(Math.floor(rnd() * n));
    const yb = idx.map((i) => y[i]);
    if (!yb.some((v) => v === 1) || !yb.some((v) => v === 0)) continue;
    const a = auc(idx.map((i) => oofA[i]), yb);
    const b = auc(idx.map((i) => oofB[i]), yb);
    if (Number.isFinite(a) && Number.isFinite(b)) diffs.push(a - b);
  }
  diffs.sort((x, y2) => x - y2);
  return {
    mean: mean(diffs),
    ci: [diffs[Math.floor(0.025 * diffs.length)], diffs[Math.min(diffs.length - 1, Math.floor(0.975 * diffs.length))]],
  };
}

// =====================================================================================
// main
// =====================================================================================

function main(): void {
  const samples = loadSamples();
  const nPos = samples.filter((s) => s.y === 1).length;
  const line = '='.repeat(100);

  console.log(line);
  console.log('로지스틱 회귀 vs 룰 기반 위험도(v3) — 정직한 비교');
  console.log(`덤프: ${DUMP_PATH}`);
  console.log(line);
  console.log(`\n표본 ${samples.length}단위 (주 × 시군구)  |  고밀도(양성) ${nPos} / 그 외 ${samples.length - nPos}`);
  console.log(`타깃: density==='high' (danger 이상, 룰 v3 대표 AUC 와 같은 타깃)`);
  console.log(`피처 ${FEATURES.length}개: ${FEATURES.join(', ')}`);
  console.log(`  (CURRENT_INFLOW=전 기간 결측, BEACH_VULNERABILITY=상수 → 제외. 절편이 상수 오프셋을 흡수)`);
  console.log(`EPV(events per variable) = ${nPos}/${FEATURES.length} = ${(nPos / FEATURES.length).toFixed(1)}  (통상 하한 10 → ${FEATURES.length}개는 과적합 위험)`);

  const folds = weekFolds(samples, KFOLDS, SEED);
  const foldSizes = Array.from({ length: KFOLDS }, (_, f) => folds.filter((x) => x === f).length);
  const foldPos = Array.from({ length: KFOLDS }, (_, f) => samples.filter((s, i) => folds[i] === f && s.y === 1).length);
  console.log(`\n그룹 ${KFOLDS}-겹 (주 단위 블록, seed=${SEED})  폴드 크기 ${foldSizes.join('/')}  폴드별 양성 ${foldPos.join('/')}`);

  const allMask = FEATURES.map((_, j) => j);

  // ---------------------------------------------------------------- (A) 룰 v3 기준선 (학습 없음)
  console.log('\n' + '-'.repeat(100));
  console.log('【기준선】 룰 v3 (고정 점수표, 학습 없음)');
  const ruleInSample = auc(samples.map((s) => s.ruleScore), samples.map((s) => s.y));
  const ruleFoldAuc = crossValidate(samples, allMask, 0, folds).perFoldRule; // 룰은 lambda/피처 무관
  console.log(`  in-sample AUC = ${fmt(ruleInSample)}   (문서의 0.886 재현 확인)`);
  console.log(`  CV(검증 폴드) AUC = ${fmt(mean(ruleFoldAuc))} ± ${fmt(sd(ruleFoldAuc))}   폴드별 [${ruleFoldAuc.map((a) => fmt(a, 2)).join(', ')}]`);
  console.log(`  * 룰은 학습이 없어 in-sample≈CV. 이게 회귀의 CV 가 넘어야 할 정직한 선이다.`);

  // ---------------------------------------------------------------- (B) L2 강도 선택 (CV)
  console.log('\n' + '-'.repeat(100));
  console.log(`【L2 정규화 강도 선택】 전체 ${FEATURES.length}피처 로지스틱, 그룹 ${KFOLDS}-겹 CV`);
  console.log(`  ${'lambda'.padStart(7)}   ${'CV AUC (평균±SD)'.padEnd(22)}  ${'폴드별'.padEnd(30)}  OOF AUC   in-sample`);
  let best = { lambda: LAMBDAS[0], cvMean: -1, cv: [] as number[], oof: NaN, inSample: NaN };
  for (const lambda of LAMBDAS) {
    const cv = crossValidate(samples, allMask, lambda, folds);
    const cvMean = mean(cv.perFoldLogit);
    const oof = auc(cv.oofLogit, cv.oofY);
    const inSampleModel = fitSubset(samples, allMask, lambda);
    const inSample = auc(samples.map((s) => predictSubset(inSampleModel, s.x)), samples.map((s) => s.y));
    console.log(
      `  ${fmt(lambda, 2).padStart(7)}   ${`${fmt(cvMean)} ± ${fmt(sd(cv.perFoldLogit))}`.padEnd(22)}  ` +
        `[${cv.perFoldLogit.map((a) => fmt(a, 2)).join(', ')}]`.padEnd(30) +
        `  ${fmt(oof)}     ${fmt(inSample)}`,
    );
    if (cvMean > best.cvMean) best = { lambda, cvMean, cv: cv.perFoldLogit, oof, inSample };
  }
  console.log(`  → CV AUC 최대: lambda=${fmt(best.lambda, 2)} (CV ${fmt(best.cvMean)}, OOF ${fmt(best.oof)}, in-sample ${fmt(best.inSample)})`);
  console.log(`  ★ 과적합 지표 = in-sample − CV = ${fmt(best.inSample - best.cvMean)}  (클수록 데이터에 계수를 맞춘 것)`);

  // ---------------------------------------------------------------- (C) 회귀 vs 룰 나란히 + 유의성
  console.log('\n' + '-'.repeat(100));
  console.log('【회귀 vs 룰 v3 — 같은 폴드, 사과 대 사과】');
  const bestCv = crossValidate(samples, allMask, best.lambda, folds);
  console.log(`  회귀(전체피처, lambda=${fmt(best.lambda, 2)})  CV ${fmt(mean(bestCv.perFoldLogit))} ± ${fmt(sd(bestCv.perFoldLogit))}  OOF ${fmt(auc(bestCv.oofLogit, bestCv.oofY))}  in-sample ${fmt(best.inSample)}`);
  console.log(`  룰 v3                        CV ${fmt(mean(ruleFoldAuc))} ± ${fmt(sd(ruleFoldAuc))}  OOF ${fmt(auc(bestCv.oofRule, bestCv.oofY))}  in-sample ${fmt(ruleInSample)}`);
  const diffFold = bestCv.perFoldLogit.map((a, i) => a - bestCv.perFoldRule[i]);
  console.log(`  폴드별 ΔAUC(회귀−룰): [${diffFold.map((d) => fmt(d, 2)).join(', ')}]  평균 ${fmt(mean(diffFold))}`);
  const boot = pairedBootstrapAuc(bestCv.oofLogit, bestCv.oofRule, bestCv.oofY, BOOT_ITERS, SEED);
  console.log(`  짝지은 부트스트랩 ${BOOT_ITERS}회 (OOF): ΔAUC(회귀−룰) 평균 ${fmt(boot.mean, 4)}  95%CI [${fmt(boot.ci[0], 3)}, ${fmt(boot.ci[1], 3)}]`);
  const verdict = boot.ci[0] > 0 ? '회귀가 유의하게 낫다' : boot.ci[1] < 0 ? '룰이 유의하게 낫다' : '구별 못 한다 (CI 가 0 을 포함)';
  console.log(`  → 판정: ${verdict}`);

  // ---------------------------------------------------------------- (D) 계수 뜯어보기 + 부트스트랩 CI
  console.log('\n' + '-'.repeat(100));
  console.log(`【회귀 계수】 전체 표본 학습, lambda=${fmt(best.lambda, 2)} (표준화 계수 — 크기 비교 가능)`);
  const full = fitSubset(samples, allMask, best.lambda);
  // 계수 부트스트랩(주 단위 그룹 리샘플) — 26개 양성으로 뽑은 계수의 불안정성.
  const rnd = mulberry32(SEED + 1);
  const weeks = [...new Set(samples.map((s) => s.endDay))];
  const byWeek = new Map<string, Sample[]>();
  for (const s of samples) (byWeek.get(s.endDay) ?? byWeek.set(s.endDay, []).get(s.endDay)!).push(s);
  const coefDraws: number[][] = FEATURES.map(() => []);
  const signFlip = FEATURES.map(() => 0);
  let bootN = 0;
  for (let it = 0; it < BOOT_ITERS; it += 1) {
    const resampled: Sample[] = [];
    for (let i = 0; i < weeks.length; i += 1) resampled.push(...byWeek.get(weeks[Math.floor(rnd() * weeks.length)])!);
    if (!resampled.some((s) => s.y === 1) || !resampled.some((s) => s.y === 0)) continue;
    const m = fitSubset(resampled, allMask, best.lambda);
    for (let j = 0; j < FEATURES.length; j += 1) {
      coefDraws[j].push(m.w[j]);
      if (Math.sign(m.w[j]) !== Math.sign(full.w[j]) && full.w[j] !== 0) signFlip[j] += 1;
    }
    bootN += 1;
  }
  console.log(`  ${'피처'.padEnd(16)} ${'계수'.padStart(8)}  ${'부호'.padStart(4)}  ${'부트스트랩 95%CI'.padEnd(22)}  부호뒤집힘  판정`);
  const dangerous: string[] = [];
  for (let j = 0; j < FEATURES.length; j += 1) {
    const c = full.w[j];
    const draws = coefDraws[j].slice().sort((a, b) => a - b);
    const lo = draws[Math.floor(0.025 * draws.length)];
    const hi = draws[Math.min(draws.length - 1, Math.floor(0.975 * draws.length))];
    const crossesZero = lo < 0 && hi > 0;
    const negative = c < -1e-6;
    let flag = '';
    if (negative) {
      flag = '⚠️ 음수(위험 방향과 반대)';
      dangerous.push(FEATURES[j]);
    } else if (crossesZero) flag = 'CI 가 0 포함(불안정)';
    console.log(
      `  ${FEATURES[j].padEnd(16)} ${fmt(c, 3).padStart(8)}  ${(c >= 0 ? '+' : '−').padStart(4)}  ` +
        `[${fmt(lo, 2)}, ${fmt(hi, 2)}]`.padEnd(22) +
        `  ${pct(signFlip[j] / Math.max(1, bootN)).padStart(8)}   ${flag}`,
    );
  }
  console.log(`  절편(b) = ${fmt(full.b, 3)}`);
  if (dangerous.length > 0) {
    console.log(`  ★ 위험한 계수(음수 = "이 신호가 강할수록 덜 위험"): ${dangerous.join(', ')}`);
    console.log(`    안전 서비스에 이대로 못 쓴다 — 통계적 우연/공선성의 산물일 수 있다.`);
  } else {
    console.log(`  음의 계수 없음. 다만 CI 가 0 을 포함하는 계수는 방향조차 불확실하다(26 양성의 한계).`);
  }

  // ---------------------------------------------------------------- (E) 간소 모델 (EPV 존중)
  console.log('\n' + '-'.repeat(100));
  console.log('【간소 모델】 EPV 하한(피처 2~3개)을 지킨 회귀 — 과적합을 구조적으로 줄인다');
  const parsimonious: Array<{ name: string; mask: Feature[] }> = [
    { name: 'NEARBY_HIGH 단독', mask: ['NEARBY_HIGH'] },
    { name: 'NEARBY_HIGH + TEMP_UP', mask: ['NEARBY_HIGH', 'TEMP_UP'] },
    { name: 'NEARBY_HIGH + NEARBY_LOW + TEMP_UP', mask: ['NEARBY_HIGH', 'NEARBY_LOW', 'TEMP_UP'] },
  ];
  console.log(`  ${'모델'.padEnd(38)} ${'CV AUC(±SD)'.padEnd(20)}  OOF     in-sample  과적합격차`);
  let bestParsimonious: { name: string; oof: number[]; cvMean: number } | null = null;
  for (const pm of parsimonious) {
    const mask = pm.mask.map((f) => FEATURES.indexOf(f));
    // 간소 모델은 정규화가 거의 불필요하나 동일 조건(best.lambda)으로도 확인
    const cv = crossValidate(samples, mask, 0, folds);
    const cvMean = mean(cv.perFoldLogit);
    const m = fitSubset(samples, mask, 0);
    const inSample = auc(samples.map((s) => predictSubset(m, s.x)), samples.map((s) => s.y));
    console.log(
      `  ${pm.name.padEnd(38)} ${`${fmt(cvMean)} ± ${fmt(sd(cv.perFoldLogit))}`.padEnd(20)}  ${fmt(auc(cv.oofLogit, cv.oofY))}   ${fmt(inSample)}     ${fmt(inSample - cvMean)}`,
    );
    if (!bestParsimonious || cvMean > bestParsimonious.cvMean) bestParsimonious = { name: pm.name, oof: cv.oofLogit, cvMean };
  }
  // 최고 간소 모델 vs 룰 v3 — 유의성(짝지은 부트스트랩). 전체피처가 진 것과 달리 여기선 비기는가?
  if (bestParsimonious) {
    const bp = pairedBootstrapAuc(bestParsimonious.oof, samples.map((s) => s.ruleScore), samples.map((s) => s.y), BOOT_ITERS, SEED);
    const v = bp.ci[0] > 0 ? '간소 회귀가 유의하게 낫다' : bp.ci[1] < 0 ? '룰이 유의하게 낫다' : '구별 못 한다 (CI 가 0 포함 = 비긴다)';
    console.log(`  [최고 간소 모델 "${bestParsimonious.name}" vs 룰 v3, OOF 짝지은 부트스트랩] ΔAUC 평균 ${fmt(bp.mean, 4)}  95%CI [${fmt(bp.ci[0], 3)}, ${fmt(bp.ci[1], 3)}]  → ${v}`);
  }

  // ---------------------------------------------------------------- (F) 하이브리드
  console.log('\n' + '-'.repeat(100));
  console.log('【하이브리드】 NEARBY(밀도)는 룰로 고정, 약한 관측 피처의 상대 가중치만 회귀로');
  console.log('  전부-회귀 vs 전부-룰의 이분법을 피한다. NEARBY 는 압도적 신호(리프트 19)라 손대지 않는다.');
  // 관측-only 회귀: NEARBY 를 뺀 관측 피처만 학습 → NEARBY 단독과 결합했을 때 이득이 있나?
  const obsMask = OBS_RULES.map((f) => FEATURES.indexOf(f));
  const cvObs = crossValidate(samples, obsMask, best.lambda, folds);
  console.log(`  관측 피처만 회귀(NEARBY 제외) CV AUC ${fmt(mean(cvObs.perFoldLogit))} ± ${fmt(sd(cvObs.perFoldLogit))}  OOF ${fmt(auc(cvObs.oofLogit, cvObs.oofY))}`);
  // 하이브리드 점수 = NEARBY 밀도등급(고 2 / 저 1 / 없음 0) 를 지배 신호로, 관측 회귀 확률을 소수점 보정으로.
  // NEARBY 등급이 주 정렬, 관측 회귀가 동점 세부 정렬(가중치 작게)이 되도록 스케일.
  const nearbyRank = samples.map((s) => (s.x[FEATURES.indexOf('NEARBY_HIGH')] ? 2 : s.x[FEATURES.indexOf('NEARBY_LOW')] ? 1 : 0));
  const hybridOof = cvObs.oofLogit.map((p, i) => nearbyRank[i] + 0.9 * p); // 관측 보정은 등급 간격(1)보다 작게
  const hybridOofAuc = auc(hybridOof, cvObs.oofY);
  const nearbyOnlyAuc = auc(nearbyRank, samples.map((s) => s.y));
  console.log(`  NEARBY 밀도등급 단독 AUC (in-sample) ${fmt(nearbyOnlyAuc)}`);
  console.log(`  하이브리드(NEARBY 등급 + 관측회귀 보정) OOF AUC ${fmt(hybridOofAuc)}`);
  console.log(`  → 하이브리드가 NEARBY 단독/룰 v3 를 넘는가? (관측 보정의 값어치)`);

  // ---------------------------------------------------------------- (G) 시간 분할 (참고용)
  console.log('\n' + '-'.repeat(100));
  const train = samples.filter((s) => s.endDay < '2026-01-01');
  const test = samples.filter((s) => s.endDay >= '2026-01-01');
  const testPos = test.filter((s) => s.y === 1).length;
  console.log(`【시간 분할】 학습(2024~2025) ${train.length} → 2026 홀드아웃 ${test.length} (고밀도 ${testPos})  ★참고용`);
  if (test.length > 0 && testPos > 0 && testPos < test.length) {
    for (const lambda of [best.lambda]) {
      const m = fitSubset(train, allMask, lambda);
      const aLogit = auc(test.map((s) => predictSubset(m, s.x)), test.map((s) => s.y));
      const aRule = auc(test.map((s) => s.ruleScore), test.map((s) => s.y));
      console.log(`  회귀(lambda=${fmt(lambda, 2)}) 2026 AUC ${fmt(aLogit)}   |   룰 v3 2026 AUC ${fmt(aRule)}`);
    }
    console.log(`  ⚠️ n=${test.length}(고밀도 ${testPos}). 신뢰구간이 표 전체를 덮는다 — 순위를 논할 수준이 아니다. CV 를 주 지표로 본다.`);
  } else {
    console.log('  홀드아웃에 양성/음성이 모두 있지 않다 — 결론 없음');
  }

  console.log('\n' + line);
  console.log('요약: 위 CV(주 단위 그룹 5-겹)를 주 지표로, 시간분할은 참고로 읽어라.');
  console.log('  회귀가 룰을 유의하게 이기는가 = (C)의 짝지은 부트스트랩 CI 가 0 을 넘는가.');
  console.log('  회귀가 안전한가 = (D)에 음의 계수/폭주가 있는가.  과적합 = (B)/(E)의 in-sample−CV 격차.');
  console.log(line);
}

main();
