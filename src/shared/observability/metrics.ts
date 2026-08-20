/**
 * 운영 지표 — **집계값을 텍스트로 바꾸는 순수 로직.**
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 이 서비스의 가장 나쁜 실패는 **"멎었는데 멀쩡해 보이는" 상태**다. 위험도 산출 배치가
 * 어젯밤부터 안 돌아도 API 는 200 을 주고, 화면에는 어제 값이 오늘 값인 양 뜬다.
 * 헬스체크는 초록이다 — 프로세스도 살아 있고 DB 도 붙으니까.
 *
 * 수집 쪽 고장은 이미 sync-health 가 본다(observation/domain/sync-health.ts). 하지만 그건
 * **입력**만 본다. 입력이 멀쩡해도 산출 배치가 죽으면 결과는 그대로 낡는다. 그 축이 비어 있었다.
 *
 * ── 왜 Prometheus 텍스트 포맷인가 ────────────────────────────────────────────────────
 * 라이브러리를 하나도 늘리지 않고(형식이 단순한 텍스트다) 외부 모니터링이 그대로 긁어갈 수
 * 있다. Grafana Agent·Prometheus·Uptime 류가 전부 이 형식을 읽는다. JSON 으로 우리만의
 * 모양을 만들면 그때부터 대시보드를 우리가 짜야 한다.
 *
 * ── 신선도를 '초' 가 아니라 '나이' 로 내보내는 이유 ──────────────────────────────────
 * 마지막 성공 **시각**을 내보내면 경보 규칙이 현재 시각을 알아야 하고, 서버·수집기의 시계가
 * 어긋나면 규칙이 흔들린다. **경과 시간**은 한쪽에서만 재므로 그 문제가 없다.
 */

/** 값이 없을 때(한 번도 안 돈 배치 등) 쓰는 표식. */
export const METRIC_ABSENT = -1;

/** 지표 한 줄. */
export interface Metric {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  /** 라벨 없는 단일 값이거나, 라벨별 값 목록. */
  samples: { labels?: Record<string, string>; value: number }[];
}

/** 지표 원자료. Kysely 질의가 채운다(metrics.kysely-query.ts). */
export interface MetricsSnapshot {
  /** 프로세스가 뜬 뒤 지난 초. */
  uptimeSeconds: number;

  /** 마지막으로 **성공(success/partial)** 한 위험도 산출이 끝난 뒤 지난 초. 없으면 null. */
  riskCalculationAgeSeconds: number | null;
  /** 산출 배치 상태별 최근 건수(최근 24시간). */
  riskCalculationCounts: { status: string; count: number }[];
  /**
   * `is_latest` 위험도 중 **가장 오래된 것**의 나이(초). 없으면 null.
   *
   * 평균이 아니라 최댓값을 쓴다 — 해변 하나만 갱신이 밀려도 그 해변 이용자에게는
   * 100% 낡은 정보이기 때문이다. 평균은 그 한 곳을 감춘다.
   */
  oldestLatestRiskScoreAgeSeconds: number | null;
  /** 현재 노출 중인 위험 단계 분포(is_latest, horizon='now'). */
  currentRiskLevels: { level: string; count: number }[];

  /** 수집 소스 건강 등급별 개수(sync-health 판정 결과). */
  syncHealthCounts: { health: string; count: number }[];

  /** AI 판별 대기(pending/processing) 건수. 쌓이면 판별이 멎은 것이다. */
  pendingVisionCount: number;
  /** 검수 대기 제보 건수(운영자 처리량 지표). */
  unreviewedReportCount: number;
  /** 가장 오래 대기 중인 AI 판별의 나이(초). 없으면 null. */
  oldestPendingVisionAgeSeconds: number | null;
}

/** 이름이 Prometheus 규약에 맞는지. 어긋난 이름은 수집기가 통째로 버린다. */
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/**
 * 라벨 값 escape. 값에 따옴표·역슬래시·개행이 들어가면 형식이 깨져 **그 스크레이프 전체가**
 * 버려진다. 라벨 값은 DB 에서 온 상태 문자열이라 이론상 얌전하지만, 형식을 지키는 쪽이
 * 값을 믿는 쪽보다 낫다.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string> | undefined): string {
  if (labels === undefined) return '';
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return parts.length === 0 ? '' : `{${parts.join(',')}}`;
}

/** 지표 목록을 Prometheus 텍스트 노출 형식으로. */
export function renderMetrics(metrics: Metric[]): string {
  const lines: string[] = [];

  for (const metric of metrics) {
    if (!METRIC_NAME.test(metric.name)) {
      throw new Error(`지표 이름이 Prometheus 규약에 맞지 않습니다: ${metric.name}`);
    }
    // HELP 의 개행은 형식을 깨므로 한 줄로 접는다.
    lines.push(`# HELP ${metric.name} ${metric.help.replace(/\n/g, ' ')}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const sample of metric.samples) {
      lines.push(`${metric.name}${formatLabels(sample.labels)} ${sample.value}`);
    }
  }

  // 노출 형식은 마지막 줄도 개행으로 끝나야 한다.
  return `${lines.join('\n')}\n`;
}

/** null(값 없음)을 표식으로 접는다. 0 으로 접으면 "방금 성공" 과 구분되지 않는다. */
function orAbsent(value: number | null): number {
  return value ?? METRIC_ABSENT;
}

/**
 * 스냅샷을 지표 목록으로.
 *
 * 이름은 `jellysafe_` 로 시작한다 — 한 Prometheus 가 여러 앱을 긁을 때 이름이 겹치지 않게.
 */
export function buildMetrics(snapshot: MetricsSnapshot): Metric[] {
  return [
    {
      name: 'jellysafe_uptime_seconds',
      help: '프로세스가 뜬 뒤 지난 시간(초).',
      type: 'gauge',
      samples: [{ value: snapshot.uptimeSeconds }],
    },
    {
      name: 'jellysafe_risk_calculation_age_seconds',
      help: `마지막으로 성공한 위험도 산출이 끝난 뒤 지난 시간(초). ${METRIC_ABSENT}=한 번도 성공한 적 없음. 이 값이 계속 커지면 산출 배치가 멎은 것이다.`,
      type: 'gauge',
      samples: [{ value: orAbsent(snapshot.riskCalculationAgeSeconds) }],
    },
    {
      name: 'jellysafe_risk_calculations_total',
      help: '최근 24시간 위험도 산출 배치 건수(상태별). failed 가 늘면 산출이 실패하고 있다.',
      type: 'gauge',
      samples: snapshot.riskCalculationCounts.map((c) => ({
        labels: { status: c.status },
        value: c.count,
      })),
    },
    {
      name: 'jellysafe_oldest_risk_score_age_seconds',
      help: `현재 노출 중인 위험도 중 가장 오래된 것의 나이(초). ${METRIC_ABSENT}=위험도 없음. 평균이 아니라 최댓값이다 — 해변 한 곳만 밀려도 그곳 이용자에게는 전부 낡은 정보다.`,
      type: 'gauge',
      samples: [{ value: orAbsent(snapshot.oldestLatestRiskScoreAgeSeconds) }],
    },
    {
      name: 'jellysafe_current_risk_level_beaches',
      help: '현재 노출 중인 위험 단계별 해변 수(horizon=now).',
      type: 'gauge',
      samples: snapshot.currentRiskLevels.map((r) => ({
        labels: { level: r.level },
        value: r.count,
      })),
    },
    {
      name: 'jellysafe_sync_sources',
      help: '수집 소스 건강 등급별 개수(sync-health 판정). unhealthy/degraded 가 있으면 입력 데이터가 말라가고 있다.',
      type: 'gauge',
      samples: snapshot.syncHealthCounts.map((s) => ({
        labels: { health: s.health },
        value: s.count,
      })),
    },
    {
      name: 'jellysafe_pending_vision_results',
      help: 'AI 판별 대기(pending/processing) 건수. 계속 쌓이면 판별이 멎은 것이다.',
      type: 'gauge',
      samples: [{ value: snapshot.pendingVisionCount }],
    },
    {
      name: 'jellysafe_oldest_pending_vision_age_seconds',
      help: `가장 오래 대기 중인 AI 판별의 나이(초). ${METRIC_ABSENT}=대기 없음.`,
      type: 'gauge',
      samples: [{ value: orAbsent(snapshot.oldestPendingVisionAgeSeconds) }],
    },
    {
      name: 'jellysafe_unreviewed_reports',
      help: '검수 대기 제보 건수. 운영자 처리량이 들어오는 양을 못 따라가는지 본다.',
      type: 'gauge',
      samples: [{ value: snapshot.unreviewedReportCount }],
    },
  ];
}

/** 스냅샷 → 노출 텍스트. 컨트롤러가 부르는 단일 진입점. */
export function renderSnapshot(snapshot: MetricsSnapshot): string {
  return renderMetrics(buildMetrics(snapshot));
}
