import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '@shared/http/global-exception.filter';
import { ResponseInterceptor } from '@shared/http/response.interceptor';
import { PrismaService } from '@shared/persistence/prisma/prisma.service';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { MysqlJobLock } from '@shared/scheduling/mysql-job-lock';
import { MetricsKyselyQuery } from '@shared/observability/metrics.kysely-query';
import { renderSnapshot } from '@shared/observability/metrics';
import { RISK_QUERY, RiskQueryPort } from '@contexts/risk/application/port/out/risk-query.port';
import {
  RISK_INPUT,
  RiskInputPort,
} from '@contexts/risk/application/port/out/risk-input.port';
import {
  CALCULATE_RISK_USE_CASE,
  CalculateRiskUseCase,
} from '@contexts/risk/application/port/in/risk-use-cases';
import { CONTRACTS } from '../prisma/value-contracts';
import {
  DailyPredictionRow,
  GROUNDTRUTH_QUERY,
  GroundtruthQueryPort,
  RISK_PREDICTION,
  RiskPredictionPort,
} from '@contexts/groundtruth/application/port/out/groundtruth-ports';
import {
  EVALUATE_PREDICTIONS_USE_CASE,
  EvaluatePredictionsUseCase,
  RECORD_FIELD_OBSERVATION_USE_CASE,
  RECORD_STING_INCIDENT_USE_CASE,
  RecordFieldObservationUseCase,
  RecordStingIncidentUseCase,
} from '@contexts/groundtruth/application/port/in/groundtruth-use-cases';
import {
  addKstDays,
  kstDayStart,
  parseKstDateKey,
  toKstDateString,
} from '@shared/kernel/kst-date';

/**
 * 영속성 계층 스모크 — **SQL 이 실제로 맞는지**를 진짜 MySQL 위에서 본다.
 *
 * ── 왜 별도 파일인가 ─────────────────────────────────────────────────────────────────
 * `flow.smoke-spec.ts` 는 "배선이 이어져 있는가" 를 HTTP 로 본다. 여기서 보는 것은 그 아래,
 * **Kysely 로 쓴 조회·집계가 실제로 의도한 행을 고르는가**다. 그 층에는 단위 테스트가 없다.
 * 포트를 가짜로 바꾸면 SQL 자체가 실행되지 않으므로 원리적으로 검증할 수 없기 때문이다.
 *
 * 이 층에서 실제로 사고가 났었다 — 다중 테이블 DELETE 제약(#28), CHECK 에 막혀 저장이 안 되던
 * 예보(#22). 둘 다 "코드는 맞는데 DB 가 거부하는" 종류라 진짜 서버 없이는 드러나지 않는다.
 *
 * 실행: `npm run db:test:up` → `npm run test:smoke`
 */
describe('영속성 스모크', () => {
  let app: INestApplication<App>;
  let http: App;
  let prisma: PrismaService;
  let db: KyselyService;
  let riskQuery: RiskQueryPort;
  let riskInput: RiskInputPort;
  let calculateRisk: CalculateRiskUseCase;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // main.ts 와 같은 전역 설정. 지표 응답이 전역 인터셉터를 어떻게 지나는지 보려면
    // 그 인터셉터가 실제로 걸려 있어야 한다.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();

    http = app.getHttpServer();

    prisma = app.get(PrismaService);
    db = app.get(KyselyService);
    riskQuery = app.get<RiskQueryPort>(RISK_QUERY);
    riskInput = app.get<RiskInputPort>(RISK_INPUT);
    calculateRisk = app.get<CalculateRiskUseCase>(CALCULATE_RISK_USE_CASE);

    // 조회를 검증하려면 볼 것이 있어야 한다. 전 해변 1회 산출로 risk_scores 를 채운다.
    await calculateRisk.calculate({ triggerType: 'manual' });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('값 계약 CHECK 제약', () => {
    /**
     * 이 검증이 이 파일에서 가장 중요한 축이다. CI 는 스키마 원본이 없어 `prisma db push` 로
     * 테이블을 만드는데, 그 경로에는 CHECK 가 없다. `prisma/sql/003` 이 그 구멍을 메우는데
     * **정말 걸렸는지는 진짜 DB 에서만 확인된다**(파일이 조용히 건너뛰어졌을 수도 있다).
     */
    it('제약이 DB 에 실제로 걸려 있다', async () => {
      // information_schema 는 Kysely 의 DB 타입에 없다. 카탈로그 조회라 raw 가 맞다.
      const rows = await prisma.$queryRaw<{ name: string }[]>`
        SELECT CONSTRAINT_NAME AS name
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK'
      `;
      const names = new Set(rows.map((r) => r.name));
      const expected = CONTRACTS.map((c) => `ck_${c.table}_${c.column}`);

      // 스키마 원본으로 만든 DB 는 제약 이름이 다를 수 있으므로 전부 일치하길 요구하지 않는다.
      // 하나도 없으면 003 이 아예 안 걸린 것이고, 그때는 CI 가 제약 없는 DB 에서 초록이 된다.
      expect(expected.filter((n) => names.has(n)).length).toBeGreaterThan(0);
    });

    it('계약 밖 값은 DB 가 거부한다 — 코드가 뚫려도 마지막 방어선이 남아 있어야 한다', async () => {
      const beach = await prisma.beach.findFirst({ where: { isActive: true } });
      expect(beach).not.toBeNull();

      await expect(
        prisma.operationAction.create({
          data: {
            beachId: beach!.id,
            // 도메인 계약에 없는 값. 애플리케이션을 우회해 직접 넣어도 막혀야 한다.
            operationStatus: 'totally_made_up_status',
            createdBy: (await prisma.user.findFirstOrThrow()).id,
          },
        }),
      ).rejects.toThrow();
    });

    it('계약 안의 값은 통과한다 — 제약이 정상 저장까지 막으면 그게 더 큰 사고다(#22)', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const user = await prisma.user.findFirstOrThrow();

      const created = await prisma.operationAction.create({
        data: { beachId: beach.id, operationStatus: 'entry_caution', createdBy: user.id },
      });
      expect(created.operationStatus).toBe('entry_caution');

      await prisma.operationAction.delete({ where: { id: created.id } });
    });
  });

  describe('위험도 조회 (Kysely)', () => {
    it('해변별 최신 위험도를 돌려준다', async () => {
      const rows = await riskQuery.listLatest({});
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.horizon).toBe('now');
        expect(['safe', 'caution', 'danger', 'severe']).toContain(row.riskLevel);
        expect(row.riskScore).toBeGreaterThanOrEqual(0);
        expect(row.riskScore).toBeLessThanOrEqual(100);
      }
    });

    it('해변마다 최신본이 정확히 하나다 — is_latest 트릭이 실제로 성립하는지', async () => {
      const rows = await riskQuery.listLatest({});
      const beachIds = rows.map((r) => r.beachId);
      expect(new Set(beachIds).size).toBe(beachIds.length);
    });

    it('두 번 산출해도 최신본은 여전히 하나다 — 갱신이 행을 늘리지 않는다', async () => {
      await calculateRisk.calculate({ triggerType: 'manual' });

      // uk_risk_scores_latest 가 지키는 불변식을 데이터로 직접 확인한다.
      const duplicated = await prisma.$queryRaw<{ beach_id: bigint; horizon: string }[]>`
        SELECT beach_id, horizon
        FROM risk_scores
        WHERE is_latest = 1
        GROUP BY beach_id, horizon
        HAVING COUNT(*) > 1
      `;

      expect(duplicated).toHaveLength(0);
    }, 120_000);

    it('지역 필터가 실제로 걸린다', async () => {
      const all = await riskQuery.listLatest({});
      const region = all[0]?.region;
      expect(region).toBeDefined();

      const filtered = await riskQuery.listLatest({ region });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((r) => r.region === region)).toBe(true);
      expect(filtered.length).toBeLessThanOrEqual(all.length);
    });

    it('단계 필터가 실제로 걸린다', async () => {
      const all = await riskQuery.listLatest({});
      const level = all[0].riskLevel;

      const filtered = await riskQuery.listLatest({ level });
      expect(filtered.every((r) => r.riskLevel === level)).toBe(true);
    });

    it('없는 지역으로 거르면 빈 배열이다 — 조건이 무시되고 전체가 나오면 안 된다', async () => {
      expect(await riskQuery.listLatest({ region: '존재하지-않는-지역' })).toEqual([]);
    });

    it('해변 상세 카드가 지평별로 나온다', async () => {
      const [first] = await riskQuery.listLatest({});
      const cards = await riskQuery.getBeachRiskCards(first.beachId);

      expect(cards.length).toBeGreaterThan(0);
      const horizons = cards.map((c) => c.horizon);
      expect(new Set(horizons).size).toBe(horizons.length); // 지평마다 최신 1건
      expect(horizons).toContain('now');
    });

    it('원인 태그를 표시 순서대로 돌려준다', async () => {
      const [first] = await riskQuery.listLatest({});
      const cards = await riskQuery.getBeachRiskCards(first.beachId);
      const now = cards.find((c) => c.horizon === 'now')!;

      const factors = await riskQuery.getFactors(now.riskScoreId);
      const orders = factors.map((f) => f.displayOrder);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('없는 해변은 null 이다', async () => {
      expect(await riskQuery.findBeach(999_999_999)).toBeNull();
    });
  });

  describe('대시보드 집계 (Kysely)', () => {
    it('요약이 스스로 모순되지 않는다', async () => {
      const summary = await riskQuery.getDashboardSummary(new Date());
      const rows = await riskQuery.listLatest({});

      expect(summary.overallScore).toBeGreaterThanOrEqual(0);
      expect(summary.overallScore).toBeLessThanOrEqual(100);

      // 대표 점수는 최신 'now' 중 최고점이어야 한다(두 질의가 같은 집합을 봐야 한다).
      const maxScore = Math.max(...rows.map((r) => r.riskScore));
      expect(summary.overallScore).toBe(maxScore);

      // 위험 이상 해변 수도 같은 집합에서 세어야 한다.
      const dangerous = rows.filter((r) => r.riskLevel === 'danger' || r.riskLevel === 'severe');
      expect(summary.dangerBeachCount).toBe(dangerous.length);
    });

    it('증감 값이 숫자로 온다 — 어제 자료가 없어도 NaN/null 이 새지 않는다', async () => {
      const { deltas } = await riskQuery.getDashboardSummary(new Date());
      for (const value of Object.values(deltas)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    });
  });

  describe('위험도 입력 수집 (Kysely)', () => {
    const options = {
      reportWindowDays: 3,
      nearbyWindowDays: 7,
      recentTempDays: 3,
      nearbyRadiusKm: 30,
      pastSeasonWindowDays: 14,
      pastSeasonYears: 5,
    };

    it('활성 해변을 돌려준다', async () => {
      const beaches = await riskInput.listActiveBeaches();
      expect(beaches.length).toBeGreaterThan(0);

      const activeCount = await prisma.beach.count({ where: { isActive: true } });
      expect(beaches).toHaveLength(activeCount);
    });

    it('해변별 입력 묶음을 만든다 — 여러 테이블 조인이 실제로 도는지', async () => {
      const [beach] = await riskInput.listActiveBeaches();
      const bundle = await riskInput.collectForBeach(beach.beachId, options);
      expect(bundle).not.toBeNull();
    });

    it('없는 해변은 null 이다', async () => {
      expect(await riskInput.collectForBeach(999_999_999, options)).toBeNull();
    });

    it('과거 이력 창을 0년으로 줘도 깨지지 않는다 — 구간이 비는 경계', async () => {
      const [beach] = await riskInput.listActiveBeaches();
      await expect(
        riskInput.collectForBeach(beach.beachId, { ...options, pastSeasonYears: 0 }),
      ).resolves.not.toThrow();
    });
  });

  describe('운영 지표 (Kysely)', () => {
    it('집계가 돌고 노출 형식으로 렌더링된다', async () => {
      const snapshot = await app.get(MetricsKyselyQuery).collect();
      const text = renderSnapshot(snapshot);

      expect(text).toContain('jellysafe_uptime_seconds');
      expect(text).toContain('jellysafe_risk_calculation_age_seconds');
      // 방금 산출했으므로 "한 번도 성공한 적 없음"(-1) 이 아니어야 한다.
      expect(snapshot.riskCalculationAgeSeconds).not.toBeNull();
      expect(snapshot.oldestLatestRiskScoreAgeSeconds).not.toBeNull();
    });

    it('현재 위험 단계 분포가 조회 결과와 맞는다', async () => {
      const snapshot = await app.get(MetricsKyselyQuery).collect();
      const rows = await riskQuery.listLatest({});

      const total = snapshot.currentRiskLevels.reduce((sum, r) => sum + r.count, 0);
      expect(total).toBe(rows.length);
    });

    /**
     * 이 경로만 공통 응답 포맷을 쓰지 않는다. 전역 인터셉터가 감싸 버리면 수집기가 파싱하지
     * 못하는데, 그건 **응답이 실제로 나가 봐야** 드러난다(단위 테스트는 인터셉터를 안 탄다).
     */
    it('HTTP 응답이 감싸이지 않은 원문 텍스트다', async () => {
      const res = await request(http)
        .get('/api/system/metrics')
        .set('x-system-key', process.env.SYSTEM_API_KEY!)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/plain');

      // 감싸였다면 본문이 `{"success":true,...}` 로 시작한다. 첫 글자가 곧 판정이다.
      // (본문 안의 `status="success"` 라벨과 헷갈리지 않도록 부분 문자열이 아니라 시작을 본다)
      expect(res.text.startsWith('# HELP jellysafe_uptime_seconds')).toBe(true);
      expect(res.text).not.toContain('{"success"');
      // 마지막 줄까지 지표 형식이어야 한다(뒤에 JSON 이 붙지 않았다).
      // 건수는 같은 DB 를 쓰는 다른 스모크가 만든 제보에 따라 달라지므로 값이 아니라 형태를 본다.
      const lastLine = res.text.trimEnd().split('\n').pop() ?? '';
      expect(lastLine).toMatch(/^jellysafe_unreviewed_reports \d+$/);
    });

    it('시스템 키가 없으면 401 이다 — 운영 정보가 담긴 경로다', async () => {
      await request(http).get('/api/system/metrics').expect(401);
    });
  });

  describe('정답 데이터 (groundtruth)', () => {
    /**
     * 이 층에서 가장 깨지기 쉬운 것은 **날짜를 KST 로 접는 부분**이다. UTC 로 저장된
     * DATETIME 을 그냥 DATE() 로 자르면 오전 9시 이전 관측이 전날로 밀린다 — 성수기 이른
     * 아침 관측이 통째로 어긋나는데, 단위 테스트로는 절대 드러나지 않는다.
     */
    it('KST 경계: 23:30 UTC 관측은 다음 날로 접힌다', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const record = app.get<RecordFieldObservationUseCase>(RECORD_FIELD_OBSERVATION_USE_CASE);

      // 2026-08-19 23:30 UTC = 2026-08-20 08:30 KST → 8/20 로 세어져야 한다.
      await record.recordObservation({
        beachId: Number(beach.id),
        observedAt: new Date('2026-08-19T23:30:00Z'),
        source: 'lifeguard',
        jellyfishPresent: false,
        observerId: null,
      });

      const query = app.get<GroundtruthQueryPort>(GROUNDTRUTH_QUERY);
      const day = parseKstDateKey('2026-08-20');
      const actuals = await query.collectDailyActuals(day, day);

      const found = actuals.find((a) => Number(a.beachId) === Number(beach.id));
      expect(found).toBeDefined();
      expect(toKstDateString(found!.targetDate)).toBe('2026-08-20');
      expect(found!.observed).toBe(true);
    });

    it('부재 관측이 저장되고 집계된다 — 이게 없으면 오경보를 셀 수 없다', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const record = app.get<RecordFieldObservationUseCase>(RECORD_FIELD_OBSERVATION_USE_CASE);

      await record.recordObservation({
        beachId: Number(beach.id),
        observedAt: new Date('2026-08-15T03:00:00Z'),
        source: 'lifeguard',
        jellyfishPresent: false,
        observerId: null,
      });

      const query = app.get<GroundtruthQueryPort>(GROUNDTRUTH_QUERY);
      const day = parseKstDateKey('2026-08-15');
      const [actual] = await query.collectDailyActuals(day, day);

      expect(actual.observed).toBe(true);
      expect(actual.maxDensity).toBeNull();
      expect(actual.incidentCount).toBe(0);
    });

    it('밀도 서열을 문자열이 아니라 순서로 집계한다 (low < medium < high)', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const record = app.get<RecordFieldObservationUseCase>(RECORD_FIELD_OBSERVATION_USE_CASE);

      // 같은 날 low → high → medium 순으로 넣는다. 문자열 MAX 라면 'medium' 이 답이 된다.
      for (const density of ['low', 'high', 'medium'] as const) {
        await record.recordObservation({
          beachId: Number(beach.id),
          observedAt: new Date('2026-08-16T04:00:00Z'),
          source: 'lifeguard',
          jellyfishPresent: true,
          densityLevel: density,
          observerId: null,
        });
      }

      const query = app.get<GroundtruthQueryPort>(GROUNDTRUTH_QUERY);
      const day = parseKstDateKey('2026-08-16');
      const [actual] = await query.collectDailyActuals(day, day);

      expect(actual.maxDensity).toBe('high');
    });

    it('사고만 있고 관측이 없는 날도 집계에 나온다 — 조인이면 빠진다(119 연계는 늦게 온다)', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const record = app.get<RecordStingIncidentUseCase>(RECORD_STING_INCIDENT_USE_CASE);

      await record.recordIncident({
        beachId: Number(beach.id),
        occurredAt: new Date('2026-08-17T05:00:00Z'),
        source: 'emergency_call',
        severity: 'moderate',
        patientCount: 2,
        reportedBy: null,
      });

      const query = app.get<GroundtruthQueryPort>(GROUNDTRUTH_QUERY);
      const day = parseKstDateKey('2026-08-17');
      const [actual] = await query.collectDailyActuals(day, day);

      expect(actual.observed).toBe(false); // 관측은 없었다
      // 피해자 수(2명)가 아니라 **사고 건수**다. 판정에는 0 인지 아닌지만 쓰이고,
      // 피해 규모는 sting_incidents.patient_count 가 따로 갖는다.
      expect(actual.incidentCount).toBe(1);
    });

    it('중복 가능성만 알리고 저장은 한다 — 기계가 병합하면 사고 건수가 조용히 줄어든다', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      const record = app.get<RecordStingIncidentUseCase>(RECORD_STING_INCIDENT_USE_CASE);
      const command = {
        beachId: Number(beach.id),
        occurredAt: new Date('2026-08-18T05:00:00Z'),
        source: 'lifeguard' as const,
        severity: 'mild' as const,
        patientCount: 1,
        externalRef: 'SMOKE-DUP-001',
        reportedBy: null,
      };

      const first = await record.recordIncident(command);
      const second = await record.recordIncident({ ...command, source: 'emergency_call' });

      expect(first.possibleDuplicate).toBe(false);
      expect(second.possibleDuplicate).toBe(true);
      expect(second.incidentId).not.toBe(first.incidentId); // 저장은 됐다
    });

    it('계약 밖 값은 DB 가 거부한다', async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      await expect(
        prisma.fieldObservation.create({
          data: {
            beachId: beach.id,
            observedAt: new Date(),
            source: 'citizen', // OBSERVATION_SOURCES 에 없다
            jellyfishPresent: false,
          },
        }),
      ).rejects.toThrow();
    });

    describe('예측 대조', () => {
      it('과거 예측을 (해변 × 날짜) 최고 단계로 읽는다', async () => {
        // beforeAll 에서 산출을 돌렸으므로 오늘 예측이 있다.
        const predictions = app.get<RiskPredictionPort>(RISK_PREDICTION);
        const today = parseKstDateKey(toKstDateString(new Date()));
        const rows = await predictions.collectDailyPredictions(today, today);

        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(['safe', 'caution', 'danger', 'severe']).toContain(row.maxLevel);
          expect(row.ruleVersion).toBeTruthy();
        }
        // 해변마다 하루 한 행이어야 한다(집계가 풀리면 여러 행이 나온다).
        const keys = rows.map((r) => `${r.beachId}:${r.targetDate.getTime()}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      /**
       * "오늘" 에 기대지 않는다.
       *
       * 처음에는 `toKstDateString(new Date())` 로 오늘을 잡았는데 CI 에서 `evaluated: 0` 이
       * 나왔다. 대조는 **예측과 실제가 같은 (해변, 날짜)** 에 있어야 성립하는데, 그 전제를
       * 시계에 맡기면 실행 시각·시간대·산출 성공 여부에 따라 흔들린다.
       *
       * 그래서 **실제로 예측이 있는 날**을 조회해서 거기에 관측을 넣는다. 검증하려는 것은
       * "예측과 실제가 만나면 판정이 저장되는가" 이지 "오늘 예측이 있는가" 가 아니다.
       */
      async function pickDayWithPrediction(): Promise<DailyPredictionRow> {
        const predictions = app.get<RiskPredictionPort>(RISK_PREDICTION);
        // 넉넉한 창으로 훑는다(산출이 어제·오늘 어디에 찍혔든 잡힌다).
        const today = parseKstDateKey(toKstDateString(new Date()));
        const from = addKstDays(today, -3);
        const to = addKstDays(today, 1);

        const rows = await predictions.collectDailyPredictions(from, to);
        expect(rows.length).toBeGreaterThan(0); // beforeAll 이 산출을 돌렸다
        return rows[0];
      }

      /**
       * 그 KST 날짜 안에 들어가는 **과거** 시각.
       *
       * 정오 무렵을 쓰되 **현재 시각으로 자른다.** 대상이 오늘인데 지금이 새벽이면 정오는
       * 아직 미래이고, 도메인이 미래 관측을 거부하기 때문이다(그게 옳은 동작이다 —
       * 미래 날짜 관측은 그날의 대조에서 조용히 빠진다).
       */
      function withinKstDay(dateKey: Date): Date {
        const noonish = new Date(kstDayStart(dateKey).getTime() + 3 * 60 * 60 * 1000);
        const now = new Date();
        return noonish.getTime() > now.getTime() ? now : noonish;
      }

      it('예측이 있는 날에 관측을 넣고 대조하면 판정이 저장된다', async () => {
        const target = await pickDayWithPrediction();

        await app
          .get<RecordFieldObservationUseCase>(RECORD_FIELD_OBSERVATION_USE_CASE)
          .recordObservation({
            beachId: target.beachId,
            observedAt: withinKstDay(target.targetDate),
            source: 'lifeguard',
            jellyfishPresent: false,
            observerId: null,
          });

        const result = await app
          .get<EvaluatePredictionsUseCase>(EVALUATE_PREDICTIONS_USE_CASE)
          .evaluate({ from: target.targetDate, to: target.targetDate });

        expect(result.evaluated).toBeGreaterThan(0);

        const saved = await prisma.predictionEvaluation.findFirst({
          where: { beachId: BigInt(target.beachId), targetDate: target.targetDate },
        });
        expect(saved).not.toBeNull();
        expect(['hit', 'miss', 'false_alarm', 'correct_negative']).toContain(saved!.outcome);
        // 판정 정책을 행에 박아 둔다 — 임계선이 바뀌어도 과거를 해석할 수 있어야 한다.
        expect(saved!.alertThreshold).toBe('danger');
        expect(saved!.predictedLevel).toBe(target.maxLevel);
      });

      it('같은 날을 다시 평가하면 덮어쓴다 — 늦게 들어온 기록을 재평가가 흡수한다', async () => {
        const target = await pickDayWithPrediction();

        await app
          .get<RecordFieldObservationUseCase>(RECORD_FIELD_OBSERVATION_USE_CASE)
          .recordObservation({
            beachId: target.beachId,
            observedAt: withinKstDay(target.targetDate),
            source: 'lifeguard',
            jellyfishPresent: false,
            observerId: null,
          });

        const evaluate = app.get<EvaluatePredictionsUseCase>(EVALUATE_PREDICTIONS_USE_CASE);
        await evaluate.evaluate({ from: target.targetDate, to: target.targetDate });
        await evaluate.evaluate({ from: target.targetDate, to: target.targetDate });

        const rows = await prisma.predictionEvaluation.count({
          where: { beachId: BigInt(target.beachId), targetDate: target.targetDate },
        });
        expect(rows).toBe(1);
      });
    });
  });

  describe('배치 분산 락 (MySQL GET_LOCK)', () => {
    /**
     * 인프로세스 락으로는 **머신이 둘일 때** 게이트가 사라진다. 그 상황을 흉내 내려면
     * 서로 다른 세션이 필요하고, 그건 진짜 MySQL 이 있어야만 만들 수 있다.
     * 여기서 락을 두 개 따로 만드는 것이 곧 "머신 두 대" 다.
     */
    it('한쪽이 잡고 있으면 다른 쪽은 실행하지 않는다', async () => {
      const machineA = new MysqlJobLock(db);
      const machineB = new MysqlJobLock(db);

      let released!: () => void;
      const holding = new Promise<void>((resolve) => {
        released = resolve;
      });

      const first = machineA.withLock('smoke-lock', () => holding);
      // A 가 실제로 잡을 때까지 잠깐 양보한다(락 획득도 DB 왕복이다).
      await new Promise((r) => setTimeout(r, 200));

      const fn = jest.fn(() => Promise.resolve('B'));
      const second = await machineB.withLock('smoke-lock', fn);

      expect(second).toEqual({ ran: false });
      expect(fn).not.toHaveBeenCalled();

      released();
      await expect(first).resolves.toEqual({ ran: true, result: undefined });
    });

    it('앞이 끝나면 다음이 잡는다 — 락이 남지 않는다', async () => {
      const lock = new MysqlJobLock(db);
      await lock.withLock('smoke-lock', () => Promise.resolve(1));

      await expect(lock.withLock('smoke-lock', () => Promise.resolve(2))).resolves.toEqual({
        ran: true,
        result: 2,
      });
    });

    it('실행이 예외로 끝나도 락이 풀린다 — 한 번 실패한 배치가 영영 막히면 안 된다', async () => {
      const lock = new MysqlJobLock(db);
      await expect(
        lock.withLock('smoke-lock', () => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      await expect(lock.withLock('smoke-lock', () => Promise.resolve('복구'))).resolves.toEqual({
        ran: true,
        result: '복구',
      });
    });

    it('이름이 다르면 서로를 막지 않는다', async () => {
      const lock = new MysqlJobLock(db);
      let released!: () => void;
      const holding = new Promise<void>((resolve) => {
        released = resolve;
      });

      const first = lock.withLock('smoke-lock-a', () => holding);
      await new Promise((r) => setTimeout(r, 200));

      await expect(lock.withLock('smoke-lock-b', () => Promise.resolve('ok'))).resolves.toEqual({
        ran: true,
        result: 'ok',
      });

      released();
      await first;
    });
  });
});
