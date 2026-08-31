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
  BEACH_QUERY,
  BeachQueryPort,
} from '@contexts/beach/application/port/out/beach-query.port';
import {
  PURGED_IMAGE_MARKER,
  REPORT_PURGE,
  ReportPurgePort,
} from '@contexts/report/application/port/out/report-purge.port';
import {
  RISK_HISTORY_PURGE,
  RiskHistoryPurgePort,
} from '@contexts/risk/application/port/out/risk-history-purge.port';
import {
  NOTIFICATION_PURGE,
  NotificationPurgePort,
} from '@contexts/notification/application/port/out/notification-purge.port';
import {
  OBSERVATION_PURGE,
  ObservationPurgePort,
} from '@contexts/observation/application/port/out/observation-purge.port';
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
  let beachQuery: BeachQueryPort;
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
    beachQuery = app.get<BeachQueryPort>(BEACH_QUERY);
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

  /**
   * 해변 목록 조회 (USR-001).
   *
   * 시민이 **가장 많이 부르는 경로**이고, 캐시를 씌운 바로 그 질의다. 그런데 커버리지가
   * 0% 였다 — 컨트롤러는 얇은 위임이라 단위 테스트 가치가 낮지만, 이 SQL 은 위험도 조인과
   * 필터가 얽혀 있어 **DB 없이는 검증할 수 없다.**
   */
  describe('해변 목록 조회 (Kysely)', () => {
    it('활성 해변을 priority 순으로 돌려준다', async () => {
      const rows = await beachQuery.listPublic({});

      expect(rows.length).toBeGreaterThan(0);
      const priorities = rows.map((r) => r.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));

      const activeCount = await prisma.beach.count({ where: { isActive: true } });
      expect(rows).toHaveLength(activeCount);
    });

    it('비활성 해변은 빠진다 — 운영에서 내린 해변이 시민 화면에 남으면 안 된다', async () => {
      const target = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      await prisma.beach.update({ where: { id: target.id }, data: { isActive: false } });

      try {
        const rows = await beachQuery.listPublic({});
        expect(rows.some((r) => Number(r.beachId) === Number(target.id))).toBe(false);
      } finally {
        await prisma.beach.update({ where: { id: target.id }, data: { isActive: true } });
      }
    });

    it('현재 위험 단계를 조인해 준다 (horizon=now, is_latest)', async () => {
      const rows = await beachQuery.listPublic({});
      const withRisk = rows.filter((r) => r.currentRiskLevel !== null);

      expect(withRisk.length).toBeGreaterThan(0);
      for (const row of withRisk) {
        expect(['safe', 'caution', 'danger', 'severe']).toContain(row.currentRiskLevel);
      }
    });

    it('산출 이력이 없는 해변은 위험 단계가 null 이다 — 0 이나 safe 로 채우지 않는다', async () => {
      // "모른다" 를 "안전하다" 로 채우는 것이 이 서비스에서 가장 나쁜 응답이다.
      const fresh = await prisma.beach.create({
        data: {
          name: `스모크-신규해변-${Date.now()}`,
          region: '제주시',
          lat: 33.9,
          lng: 126.9,
          priority: 99,
          isActive: true,
        },
      });

      try {
        const rows = await beachQuery.listPublic({});
        const mine = rows.find((r) => Number(r.beachId) === Number(fresh.id));
        expect(mine).toBeDefined();
        expect(mine!.currentRiskLevel).toBeNull();
      } finally {
        await prisma.beach.delete({ where: { id: fresh.id } });
      }
    });

    it('지역 필터가 실제로 걸린다', async () => {
      const all = await beachQuery.listPublic({});
      const region = all[0].region;

      const filtered = await beachQuery.listPublic({ region });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((r) => r.region === region)).toBe(true);
      expect(filtered.length).toBeLessThanOrEqual(all.length);
    });

    it('이름 검색이 부분 일치로 걸린다', async () => {
      const all = await beachQuery.listPublic({});
      // 이름 가운데 두 글자로 찾아도 잡혀야 한다(앞부분 일치만 되면 검색이 쓸모없다).
      const target = all[0].name;
      const middle = target.slice(1, 3);

      const found = await beachQuery.listPublic({ keyword: middle });
      expect(found.some((r) => r.name === target)).toBe(true);
    });

    it('없는 지역으로 거르면 빈 배열이다 — 조건이 무시되고 전체가 나오면 안 된다', async () => {
      expect(await beachQuery.listPublic({ region: '존재하지-않는-지역' })).toEqual([]);
    });

    it('검색어에 와일드카드가 들어가도 전체가 새어 나오지 않는다', async () => {
      // LIKE 패턴을 문자 그대로 다루지 않으면 `%` 하나로 목록이 통째로 노출된다.
      // (지금은 필터가 좁혀지기만 하면 되고, 전체와 같아지지 않는 것이 핵심이다)
      const all = await beachQuery.listPublic({});
      const wild = await beachQuery.listPublic({ keyword: '존재하지않는이름%' });
      expect(wild.length).toBeLessThan(all.length);
    });

    it('좌표 조회는 비활성 해변까지 준다 — 활성 판단은 부르는 쪽 도메인이 한다', async () => {
      const locations = await beachQuery.listLocations();
      const total = await prisma.beach.count();
      expect(locations).toHaveLength(total);
      expect(locations.every((l) => typeof l.isActive === 'boolean')).toBe(true);
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

  describe('관측소 선택 규칙 (신선하면 최근접)', () => {
    /**
     * 예전에는 매핑된 관측소 전부에서 가장 **최신** 관측을 뽑았다. 그러면 멀리 있는 부이가
     * 조금 더 최근에 보고했다는 이유로 가까운 관측소를 제친다 — 해변의 관측 출처가 실행마다
     * 달라지고, 해류처럼 **한쪽만 주는 값**은 있었다 없었다 한다.
     *
     * 이건 SQL 정렬 규칙이라 단위 테스트로는 확인할 수 없다.
     */
    let beachId: number;
    let beachIdBig: bigint;
    let nearStationId: bigint;
    let farStationId: bigint;

    beforeAll(async () => {
      const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
      beachId = Number(beach.id);
      beachIdBig = beach.id;

      // 매핑은 수집 배치(MapStationsService)가 만든다. 스모크에서는 그 배치가 돌지 않으므로
      // **여기서 직접 만든다** — 검증 대상은 매핑을 만드는 규칙이 아니라 관측치를 고르는 규칙이다.
      const stations = await prisma.observationStation.findMany({
        where: { stationType: 'marine', isActive: true },
        take: 2,
      });
      expect(stations.length).toBeGreaterThanOrEqual(2);
      nearStationId = stations[0].id;
      farStationId = stations[1].id;

      await prisma.observationMapping.deleteMany({
        where: { beachId: beachIdBig, stationType: 'marine' },
      });
      await prisma.observationMapping.createMany({
        data: [
          // 대표(최근접). is_primary 는 1 또는 NULL 이다("1 또는 NULL" 트릭).
          { beachId: beachIdBig, stationId: nearStationId, stationType: 'marine', distanceKm: 1, isPrimary: true },
          { beachId: beachIdBig, stationId: farStationId, stationType: 'marine', distanceKm: 50, isPrimary: null },
        ],
      });
    });

    /** 그 해변의 관측을 지우고 두 관측소에 하나씩 심는다. */
    async function seedPair(nearAt: Date, farAt: Date): Promise<void> {
      await prisma.observation.deleteMany({
        where: { stationId: { in: [nearStationId, farStationId] } },
      });
      await prisma.observation.create({
        data: {
          stationId: nearStationId,
          observedAt: nearAt,
          waterTemp: 20,
          // 가까운 관측소만 해류를 준다(실제로 국립해양조사원만 유향·유속을 관측한다).
          currentDirection: 90,
          currentSpeed: 1.5,
        },
      });
      await prisma.observation.create({
        data: { stationId: farStationId, observedAt: farAt, waterTemp: 25 },
      });
    }

    it('둘 다 신선하면 먼 곳이 더 최근이어도 최근접을 쓴다', async () => {
      const now = Date.now();
      await seedPair(new Date(now - 60 * 60_000), new Date(now - 5 * 60_000));

      const bundle = await riskInput.collectForBeach(beachId, {
        reportWindowDays: 3,
        nearbyWindowDays: 7,
        recentTempDays: 3,
        nearbyRadiusKm: 30,
        pastSeasonWindowDays: 14,
        pastSeasonYears: 5,
      });

      // 최근접(수온 20, 해류 있음)이 선택돼야 한다. 먼 곳이면 수온 25, 해류 null 이다.
      expect(bundle?.latestObservation?.waterTemp).toBe(20);
      expect(bundle?.latestObservation?.currentSpeed).not.toBeNull();
    });

    it('최근접이 낡았고 먼 곳만 신선하면 먼 곳을 쓴다 — 아무것도 없는 것보다 낫다', async () => {
      const now = Date.now();
      // 최근접은 이틀 전(신선 기준 24시간 초과), 먼 곳은 방금.
      await seedPair(new Date(now - 48 * 60 * 60_000), new Date(now - 5 * 60_000));

      const bundle = await riskInput.collectForBeach(beachId, {
        reportWindowDays: 3,
        nearbyWindowDays: 7,
        recentTempDays: 3,
        nearbyRadiusKm: 30,
        pastSeasonWindowDays: 14,
        pastSeasonYears: 5,
      });

      expect(bundle?.latestObservation?.waterTemp).toBe(25);
    });

    afterAll(async () => {
      // 뒤 테스트가 이 해변의 관측·매핑을 전제하지 않도록 정리한다.
      await prisma.observation.deleteMany({
        where: { stationId: { in: [nearStationId, farStationId] } },
      });
      await prisma.observationMapping.deleteMany({
        where: { beachId: beachIdBig, stationType: 'marine' },
      });
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

  /**
   * 파기 배치.
   *
   * ── 왜 여기서 보는가 ──────────────────────────────────────────────────────────────
   * 파기는 **되돌릴 수 없다.** 다른 버그는 고치면 되지만 지워진 제보 사진과 관측 이력은
   * 돌아오지 않는다. 그런데 파기 리포지토리에는 테스트가 하나도 없었다.
   *
   * 그리고 실제로 사고가 났던 자리다 — 다중 테이블 DELETE 제약(#28). 전부 Prisma 원시
   * SQL 이라 **DB 없이는 원리적으로 검증할 수 없다.**
   *
   * 조용히 실패하는 방향이 둘이라 양쪽을 다 본다.
   *   · 안 지워야 할 것을 지운다 → 화면에 표시할 값이 사라진다(가장 나쁘다)
   *   · 지워야 할 것을 안 지운다 → 보관 기간이 늘어나 개인정보 파기 의무를 어긴다
   */
  describe('파기 배치', () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    describe('위험도 산출 이력', () => {
      /**
       * 산출 1건을 만들고 점수(is_latest 여부 지정)와 요인을 붙인다.
       * @returns 산출 id
       */
      async function makeCalculation(options: {
        startedAt: Date;
        isLatest: boolean;
        beachId: bigint;
        horizon: string;
      }): Promise<bigint> {
        const calc = await prisma.riskCalculation.create({
          data: {
            calculationUid: `purge-${Math.round(options.startedAt.getTime())}-${options.horizon}-${options.isLatest ? 'L' : 'H'}`,
            triggerType: 'manual',
            ruleVersion: 'v3',
            calcStatus: 'success',
            startedAt: options.startedAt,
            finishedAt: options.startedAt,
          },
        });
        const score = await prisma.riskScore.create({
          data: {
            calculationId: calc.id,
            beachId: options.beachId,
            horizon: options.horizon,
            riskScore: 10,
            riskLevel: 'safe',
            dataConfidence: 'medium',
            ruleVersion: 'v3',
            // "1 또는 NULL" 트릭 — 최신본에만 1 이 들어간다.
            isLatest: options.isLatest ? true : null,
            generatedAt: options.startedAt,
          },
        });
        await prisma.riskFactor.create({
          data: {
            riskScoreId: score.id,
            factorCode: 'TEMP_UP',
            factorName: '수온 상승',
            scoreDelta: 10,
            displayOrder: 0,
          },
        });
        return calc.id;
      }

      it('현재 값(is_latest)이 매달린 산출은 오래돼도 지우지 않는다', async () => {
        // 이걸 지우면 CASCADE 로 risk_scores 까지 날아가고, 오래 재산출되지 않은 해변은
        // **화면에 보여줄 위험도가 사라진다.** 파기에서 가장 나쁜 실패다.
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        const old = new Date(Date.now() - 400 * DAY);

        const keepId = await makeCalculation({
          startedAt: old,
          isLatest: true,
          beachId: beach.id,
          // uk_risk_scores_latest(beach_id, horizon, is_latest) 때문에 (해변, 지평)당 최신본은
          // 하나뿐이다. 산출기는 now/24h/72h 만 만들므로(HORIZONS) 계약에 있지만 쓰이지 않는
          // '6h' 를 쓴다 — 제약과 부딪히지 않으면서 같은 규칙을 검증할 수 있다.
          horizon: '6h',
        });

        const purge = app.get<RiskHistoryPurgePort>(RISK_HISTORY_PURGE);
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), 50);

        expect(await prisma.riskCalculation.findUnique({ where: { id: keepId } })).not.toBeNull();
      });

      it('오래된 이력은 지우고, 점수·요인도 함께 사라진다(CASCADE)', async () => {
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        const old = new Date(Date.now() - 400 * DAY);

        const dropId = await makeCalculation({
          startedAt: old,
          isLatest: false,
          beachId: beach.id,
          horizon: '24h',
        });
        const scoresBefore = await prisma.riskScore.count({ where: { calculationId: dropId } });
        expect(scoresBefore).toBe(1);

        const purge = app.get<RiskHistoryPurgePort>(RISK_HISTORY_PURGE);
        const deleted = await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), 50);

        expect(deleted).toBeGreaterThan(0);
        expect(await prisma.riskCalculation.findUnique({ where: { id: dropId } })).toBeNull();
        expect(await prisma.riskScore.count({ where: { calculationId: dropId } })).toBe(0);
      });

      it('보관 기간 안의 이력은 건드리지 않는다', async () => {
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        const recent = new Date(Date.now() - 3 * DAY);

        const keepId = await makeCalculation({
          startedAt: recent,
          isLatest: false,
          beachId: beach.id,
          horizon: '6h', // is_latest 가 NULL 이면 유니크 제약에 걸리지 않는다
        });

        const purge = app.get<RiskHistoryPurgePort>(RISK_HISTORY_PURGE);
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), 50);

        expect(await prisma.riskCalculation.findUnique({ where: { id: keepId } })).not.toBeNull();
      });

      it('배치 크기보다 많아도 끝까지 지운다 — 한 번에 한 배치만 지우면 이력이 계속 쌓인다', async () => {
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        const old = new Date(Date.now() - 500 * DAY);

        const ids: bigint[] = [];
        for (let i = 0; i < 5; i += 1) {
          ids.push(
            await makeCalculation({
              startedAt: new Date(old.getTime() + i * 1000),
              isLatest: false,
              beachId: beach.id,
              horizon: `24h`,
            }),
          );
        }

        const purge = app.get<RiskHistoryPurgePort>(RISK_HISTORY_PURGE);
        // 배치 크기 2 — 세 번 이상 돌아야 다 지워진다.
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), 2);

        const left = await prisma.riskCalculation.count({ where: { id: { in: ids } } });
        expect(left).toBe(0);
      });
    });

    describe('제보 보관정책 (PRIV-003)', () => {
      async function makeReport(purgeScheduledAt: Date, imageUrl: string) {
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        return prisma.jellyfishReport.create({
          data: {
            beachId: beach.id,
            reportType: 'general',
            status: 'received',
            occurredAt: new Date(),
            lat: 33.5,
            lng: 126.5,
            imageUrl,
            purgeScheduledAt,
          },
        });
      }

      it('기한이 지난 제보의 사진·좌표를 마스킹하고, 마스킹 전 URL 을 돌려준다', async () => {
        // URL 을 돌려주는 이유가 중요하다 — 마스킹하면 그 값을 다시는 알 수 없으므로,
        // 호출자가 **파일까지** 지우려면 지우기 전에 받아야 한다.
        const report = await makeReport(new Date(Date.now() - HOUR), '/uploads/purge-me.jpg');

        const purge = app.get<ReportPurgePort>(REPORT_PURGE);
        const targets = await purge.purgeExpired(new Date());

        const mine = targets.find((t) => Number(t.reportId) === Number(report.id));
        expect(mine).toBeDefined();
        expect(mine!.imageUrl).toBe('/uploads/purge-me.jpg');

        const after = await prisma.jellyfishReport.findUniqueOrThrow({ where: { id: report.id } });
        expect(after.imageUrl).toBe(PURGED_IMAGE_MARKER);
        expect(after.lat).toBeNull();
        expect(after.lng).toBeNull();
      });

      it('기한이 아직인 제보는 건드리지 않는다 — 검수 전에 사진이 사라지면 안 된다', async () => {
        const report = await makeReport(new Date(Date.now() + 30 * DAY), '/uploads/keep.jpg');

        const purge = app.get<ReportPurgePort>(REPORT_PURGE);
        const targets = await purge.purgeExpired(new Date());

        expect(targets.some((t) => Number(t.reportId) === Number(report.id))).toBe(false);

        const after = await prisma.jellyfishReport.findUniqueOrThrow({ where: { id: report.id } });
        expect(after.imageUrl).toBe('/uploads/keep.jpg');
        expect(after.lat).not.toBeNull();
      });

      it('이미 파기된 제보를 다시 잡지 않는다 — 매번 같은 건을 파일 삭제 대상으로 올리면 안 된다', async () => {
        await makeReport(new Date(Date.now() - HOUR), '/uploads/once.jpg');

        const purge = app.get<ReportPurgePort>(REPORT_PURGE);
        const first = await purge.purgeExpired(new Date());
        const second = await purge.purgeExpired(new Date());

        expect(first.length).toBeGreaterThan(0);
        expect(second.length).toBe(0);
      });
    });

    describe('알림', () => {
      async function makeNotification(createdAt: Date, cooldownUntil: Date | null) {
        const beach = await prisma.beach.findFirstOrThrow({ where: { isActive: true } });
        return prisma.notification.create({
          data: {
            targetType: 'public',
            beachId: beach.id,
            eventType: 'level_up',
            title: '파기 테스트',
            message: '파기 테스트',
            createdAt,
            cooldownUntil,
          },
        });
      }

      it('쿨다운이 아직 남아 있으면 오래돼도 남긴다 — 지우면 중복 방지가 조용히 풀린다', async () => {
        const kept = await makeNotification(
          new Date(Date.now() - 400 * DAY),
          new Date(Date.now() + HOUR), // 아직 미래
        );

        const purge = app.get<NotificationPurgePort>(NOTIFICATION_PURGE);
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), new Date(), 100);

        expect(await prisma.notification.findUnique({ where: { id: kept.id } })).not.toBeNull();
      });

      it('쿨다운이 끝난 오래된 알림은 지운다', async () => {
        const dropped = await makeNotification(
          new Date(Date.now() - 400 * DAY),
          new Date(Date.now() - 10 * DAY), // 이미 지났다
        );

        const purge = app.get<NotificationPurgePort>(NOTIFICATION_PURGE);
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), new Date(), 100);

        expect(await prisma.notification.findUnique({ where: { id: dropped.id } })).toBeNull();
      });
    });

    describe('관측', () => {
      it('오래된 관측만 지운다', async () => {
        const station = await prisma.observationStation.findFirstOrThrow();
        const old = await prisma.observation.create({
          data: {
            stationId: station.id,
            observedAt: new Date(Date.now() - 400 * DAY),
            waterTemp: 20,
          },
        });
        const recent = await prisma.observation.create({
          data: {
            stationId: station.id,
            observedAt: new Date(Date.now() - 2 * DAY),
            waterTemp: 21,
          },
        });

        const purge = app.get<ObservationPurgePort>(OBSERVATION_PURGE);
        await purge.purgeOlderThan(new Date(Date.now() - 90 * DAY), 100);

        expect(await prisma.observation.findUnique({ where: { id: old.id } })).toBeNull();
        expect(await prisma.observation.findUnique({ where: { id: recent.id } })).not.toBeNull();

        await prisma.observation.deleteMany({ where: { id: recent.id } });
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
