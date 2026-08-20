import {
  METRIC_ABSENT,
  Metric,
  MetricsSnapshot,
  buildMetrics,
  renderMetrics,
  renderSnapshot,
} from './metrics';

/**
 * 지표가 지켜야 하는 것은 두 가지다.
 *  1. **형식이 정확할 것** — 한 줄만 어긋나도 수집기가 그 스크레이프를 통째로 버린다.
 *     그러면 지표가 사라지는데, 그 상태는 "서비스가 죽은 것" 과 화면상 구분되지 않는다.
 *  2. **없음과 0 을 구분할 것** — "한 번도 성공한 적 없음" 을 0 으로 내보내면
 *     "방금 성공했음" 과 같은 값이 되어 경보가 반대로 뒤집힌다.
 */
describe('운영 지표', () => {
  const snapshot: MetricsSnapshot = {
    uptimeSeconds: 3600,
    riskCalculationAgeSeconds: 120,
    riskCalculationCounts: [
      { status: 'success', count: 46 },
      { status: 'failed', count: 2 },
    ],
    oldestLatestRiskScoreAgeSeconds: 1800,
    currentRiskLevels: [
      { level: 'safe', count: 9 },
      { level: 'caution', count: 3 },
    ],
    syncHealthCounts: [{ health: 'success', count: 4 }],
    pendingVisionCount: 2,
    unreviewedReportCount: 7,
    oldestPendingVisionAgeSeconds: 45,
  };

  describe('노출 형식', () => {
    it('지표마다 HELP·TYPE·값 줄을 낸다', () => {
      const metrics: Metric[] = [
        { name: 'x_total', help: '설명', type: 'gauge', samples: [{ value: 3 }] },
      ];
      expect(renderMetrics(metrics)).toBe('# HELP x_total 설명\n# TYPE x_total gauge\nx_total 3\n');
    });

    it('마지막 줄도 개행으로 끝난다 — 규격이 요구한다', () => {
      expect(renderSnapshot(snapshot).endsWith('\n')).toBe(true);
    });

    it('라벨을 붙인다', () => {
      const metrics: Metric[] = [
        {
          name: 'x',
          help: 'h',
          type: 'gauge',
          samples: [{ labels: { status: 'failed' }, value: 2 }],
        },
      ];
      expect(renderMetrics(metrics)).toContain('x{status="failed"} 2');
    });

    it('라벨이 여럿이면 쉼표로 잇는다', () => {
      const metrics: Metric[] = [
        { name: 'x', help: 'h', type: 'gauge', samples: [{ labels: { a: '1', b: '2' }, value: 0 }] },
      ];
      expect(renderMetrics(metrics)).toContain('x{a="1",b="2"} 0');
    });

    it('HELP 의 개행을 접는다 — 여러 줄이면 형식이 깨진다', () => {
      const metrics: Metric[] = [
        { name: 'x', help: '첫 줄\n둘째 줄', type: 'gauge', samples: [{ value: 1 }] },
      ];
      expect(renderMetrics(metrics)).toContain('# HELP x 첫 줄 둘째 줄');
    });

    it('라벨 값의 따옴표·역슬래시·개행을 escape 한다', () => {
      const metrics: Metric[] = [
        {
          name: 'x',
          help: 'h',
          type: 'gauge',
          samples: [{ labels: { s: 'a"b\\c\nd' }, value: 1 }],
        },
      ];
      expect(renderMetrics(metrics)).toContain('x{s="a\\"b\\\\c\\nd"} 1');
    });

    it('규약에 맞지 않는 이름은 던진다 — 조용히 내보내면 그 스크레이프가 통째로 버려진다', () => {
      const metrics: Metric[] = [
        { name: 'jellysafe-bad-name', help: 'h', type: 'gauge', samples: [{ value: 1 }] },
      ];
      expect(() => renderMetrics(metrics)).toThrow(/Prometheus/);
    });

    it('샘플이 없는 지표도 HELP·TYPE 은 낸다 — 지표의 부재 자체가 정보다', () => {
      const metrics: Metric[] = [{ name: 'x', help: 'h', type: 'gauge', samples: [] }];
      expect(renderMetrics(metrics)).toBe('# HELP x h\n# TYPE x gauge\n');
    });
  });

  describe('없음과 0 의 구분', () => {
    it('한 번도 성공한 적 없는 산출은 -1 이다 (0 이면 "방금 성공" 과 같아진다)', () => {
      const text = renderSnapshot({ ...snapshot, riskCalculationAgeSeconds: null });
      expect(text).toContain(`jellysafe_risk_calculation_age_seconds ${METRIC_ABSENT}`);
    });

    it('위험도가 하나도 없으면 -1 이다', () => {
      const text = renderSnapshot({ ...snapshot, oldestLatestRiskScoreAgeSeconds: null });
      expect(text).toContain(`jellysafe_oldest_risk_score_age_seconds ${METRIC_ABSENT}`);
    });

    it('대기 중인 AI 판별이 없으면 나이는 -1, 건수는 0 이다', () => {
      const text = renderSnapshot({
        ...snapshot,
        pendingVisionCount: 0,
        oldestPendingVisionAgeSeconds: null,
      });
      expect(text).toContain(`jellysafe_oldest_pending_vision_age_seconds ${METRIC_ABSENT}`);
      expect(text).toContain('jellysafe_pending_vision_results 0');
    });

    it('실제 0초 경과는 0 으로 나온다 — -1 과 섞이지 않는다', () => {
      const text = renderSnapshot({ ...snapshot, riskCalculationAgeSeconds: 0 });
      expect(text).toContain('jellysafe_risk_calculation_age_seconds 0\n');
    });
  });

  describe('지표 구성', () => {
    it('모든 지표 이름이 jellysafe_ 로 시작한다 — 한 수집기가 여러 앱을 긁을 때 겹치지 않게', () => {
      for (const metric of buildMetrics(snapshot)) {
        expect(metric.name.startsWith('jellysafe_')).toBe(true);
      }
    });

    it('지표 이름이 중복되지 않는다', () => {
      const names = buildMetrics(snapshot).map((m) => m.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('신선도 지표가 들어 있다 — 이 서비스의 가장 나쁜 실패를 보는 축이다', () => {
      const names = buildMetrics(snapshot).map((m) => m.name);
      expect(names).toContain('jellysafe_risk_calculation_age_seconds');
      expect(names).toContain('jellysafe_oldest_risk_score_age_seconds');
    });

    it('상태별 건수는 라벨로 펼친다', () => {
      const text = renderSnapshot(snapshot);
      expect(text).toContain('jellysafe_risk_calculations_total{status="success"} 46');
      expect(text).toContain('jellysafe_risk_calculations_total{status="failed"} 2');
    });

    it('위험 단계 분포를 단계별로 낸다', () => {
      const text = renderSnapshot(snapshot);
      expect(text).toContain('jellysafe_current_risk_level_beaches{level="safe"} 9');
      expect(text).toContain('jellysafe_current_risk_level_beaches{level="caution"} 3');
    });

    it('집계 결과가 비어 있어도 렌더링이 깨지지 않는다 (시드 직후·새 DB)', () => {
      const empty: MetricsSnapshot = {
        uptimeSeconds: 1,
        riskCalculationAgeSeconds: null,
        riskCalculationCounts: [],
        oldestLatestRiskScoreAgeSeconds: null,
        currentRiskLevels: [],
        syncHealthCounts: [],
        pendingVisionCount: 0,
        unreviewedReportCount: 0,
        oldestPendingVisionAgeSeconds: null,
      };
      expect(() => renderSnapshot(empty)).not.toThrow();
      expect(renderSnapshot(empty)).toContain('jellysafe_uptime_seconds 1');
    });
  });
});
