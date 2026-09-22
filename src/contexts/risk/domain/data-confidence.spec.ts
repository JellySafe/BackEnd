import { THRESHOLDS, deriveConfidence } from './risk-assessment';
import { dataConfidenceLabelOf } from './data-confidence-label';

/**
 * 관측 자료 상태 판정.
 *
 * ── 이 판정이 답하는 것과 답하지 않는 것 ─────────────────────────────────────────────
 * 답하는 것: **이 판정을 뒷받침할 관측 자료가 충분한가.**
 * 답하지 않는 것: **예측이 맞는가.** 입력이 완벽해도 룰이 틀렸으면 예측은 틀린다.
 *
 * 그 차이를 흐리면 이 서비스에서 위험한 방향으로 어긋난다 — `안전` + `높음` 을 본 사람은
 * 물에 들어간다.
 */
describe('deriveConfidence', () => {
  const FRESH = 10;
  const NEAR = 3;

  it('다 있고 신선하고 가까우면 high', () => {
    expect(deriveConfidence([], FRESH, NEAR)).toBe('high');
  });

  it('관측이 아예 없으면 low', () => {
    expect(deriveConfidence([], null, null)).toBe('low');
  });

  describe('⚠️ 결측은 개수가 아니라 무게로 센다', () => {
    /**
     * 이 블록이 **실제 결함**을 고정한다.
     *
     * 예전에는 개수만 셌고 low 기준이 3이었다. 그런데 수온이 없으면 TEMP_UP 과
     * TEMP_7D_AVG 가 **함께** 빠져 개수가 2였다 — 그래서 수온을 한 값도 못 받은 해변이
     * 'medium' 으로 나왔다. 입력의 절반이 없는데 "보통" 이라고 답한 셈이다.
     */
    it('수온을 한 값도 못 받으면 low 다 — 예전에는 medium 이었다', () => {
      expect(deriveConfidence(['TEMP_UP', 'TEMP_7D_AVG'], FRESH, NEAR)).toBe('low');
    });

    it('유향·유속만 없으면 medium — 제주 해변 대부분이 이 상태다', () => {
      expect(deriveConfidence(['CURRENT_INFLOW'], FRESH, NEAR)).toBe('medium');
    });

    it('부차 요인 둘이 없어도 medium', () => {
      expect(deriveConfidence(['CURRENT_INFLOW', 'WAVE_HIGH'], FRESH, NEAR)).toBe('medium');
    });

    it('부차 요인 셋이 겹치면 low', () => {
      expect(deriveConfidence(['CURRENT_INFLOW', 'WAVE_HIGH', 'WIND_INFLOW'], FRESH, NEAR)).toBe(
        'low',
      );
    });

    it('표에 없는 코드도 1점으로 센다 — 룰이 늘어도 조용히 0점이 되지 않는다', () => {
      expect(deriveConfidence(['NEW_RULE_A', 'NEW_RULE_B', 'NEW_RULE_C'], FRESH, NEAR)).toBe('low');
    });
  });

  describe('⚠️ 관측소가 멀면 내린다 — 예전에는 거리를 아예 보지 않았다', () => {
    it('대표 거리(10km) 안이면 그대로 high', () => {
      expect(deriveConfidence([], FRESH, THRESHOLDS.representativeDistanceKm)).toBe('high');
    });

    it('10km 를 넘으면 한 단계 내린다 — 그 값은 이 해변의 것이라고 보기 어렵다', () => {
      expect(deriveConfidence([], FRESH, THRESHOLDS.representativeDistanceKm + 0.1)).toBe('medium');
    });

    it('30km 를 넘으면 두 단계 — 엔진이 "인근" 으로도 치지 않는 거리다', () => {
      expect(deriveConfidence([], FRESH, THRESHOLDS.farDistanceKm + 1)).toBe('low');
    });

    it('거리를 모르면 벌점이 없다 — 그 상황은 결측 무게가 이미 잡는다', () => {
      expect(deriveConfidence([], FRESH, null)).toBe('high');
    });

    it('결측과 거리가 겹치면 함께 내려간다', () => {
      // 유속 결측(medium) + 먼 관측소(한 단계) = low
      expect(deriveConfidence(['CURRENT_INFLOW'], FRESH, 25)).toBe('low');
    });
  });

  describe('신선도', () => {
    it('3시간을 넘으면 high 를 주지 않는다', () => {
      expect(deriveConfidence([], THRESHOLDS.freshObservationMinutes + 1, NEAR)).toBe('medium');
    });

    it('하루를 넘으면 low', () => {
      expect(deriveConfidence([], THRESHOLDS.staleObservationMinutes + 1, NEAR)).toBe('low');
    });
  });
});

describe('dataConfidenceLabelOf', () => {
  it('⚠️ 라벨에 "신뢰도" 라는 말을 쓰지 않는다', () => {
    // "신뢰도 높음" 은 "이 예측을 믿어도 된다" 로 읽힌다. 그건 측정한 적 없는 주장이다
    // (해변별 정확도 표본 0건). 라벨은 자료 이야기만 해야 한다.
    for (const level of ['high', 'medium', 'low'] as const) {
      expect(dataConfidenceLabelOf(level, 'ko')).not.toContain('신뢰');
    }
  });

  it('자료 이야기를 한다', () => {
    expect(dataConfidenceLabelOf('high', 'ko')).toContain('관측 자료');
    expect(dataConfidenceLabelOf('low', 'ko')).toContain('부족');
  });

  it('지원 언어 넷을 모두 준다', () => {
    for (const locale of ['ko', 'en', 'zh', 'ja'] as const) {
      expect(dataConfidenceLabelOf('medium', locale).length).toBeGreaterThan(0);
    }
    // 언어별로 실제 다른 문구여야 한다 — ko 로 폴백되면 외국인에게 한국어가 나간다.
    expect(dataConfidenceLabelOf('medium', 'en')).not.toBe(dataConfidenceLabelOf('medium', 'ko'));
  });
});
