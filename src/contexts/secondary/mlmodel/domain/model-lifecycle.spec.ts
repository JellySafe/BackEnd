import { assertModelTransition, normalizeMetrics } from './model-lifecycle';

describe('모델 상태 전이', () => {
  it('학습 → 검증 → 운영 순서를 따른다', () => {
    expect(() => assertModelTransition('training', 'staging')).not.toThrow();
    expect(() => assertModelTransition('staging', 'active')).not.toThrow();
    expect(() => assertModelTransition('active', 'archived')).not.toThrow();
  });

  it('학습 중인 모델을 곧바로 운영에 올릴 수 없다 — 검증 없이 판단이 바뀌면 안 된다', () => {
    expect(() => assertModelTransition('training', 'active')).toThrow(
      expect.objectContaining({ code: 'MODEL_INVALID_TRANSITION' }),
    );
  });

  it('보관은 종착이다 — 다시 쓰려면 새 버전으로 등록한다', () => {
    expect(() => assertModelTransition('archived', 'active')).toThrow();
    expect(() => assertModelTransition('archived', 'staging')).toThrow();
  });

  it('어느 단계에서든 보관으로 내릴 수 있다 (문제가 생기면 즉시 내려야 한다)', () => {
    expect(() => assertModelTransition('training', 'archived')).not.toThrow();
    expect(() => assertModelTransition('staging', 'archived')).not.toThrow();
  });

  it('알 수 없는 상태는 거부한다', () => {
    expect(() => assertModelTransition('training', 'deployed' as 'active')).toThrow(
      expect.objectContaining({ code: 'MODEL_STATUS_INVALID' }),
    );
  });
});

describe('성능 지표 정규화', () => {
  it('숫자 지표를 그대로 받는다', () => {
    expect(normalizeMetrics({ auc: 0.886, recall: 0.731 })).toEqual({ auc: 0.886, recall: 0.731 });
  });

  it('숫자로 읽히는 문자열은 숫자로 바꾼다 — "0.87" 과 0.87 이 섞이면 비교가 깨진다', () => {
    expect(normalizeMetrics({ auc: '0.87' })).toEqual({ auc: 0.87 });
  });

  it('숫자가 아닌 값은 거부한다', () => {
    expect(() => normalizeMetrics({ note: '좋음' })).toThrow(
      expect.objectContaining({ code: 'MODEL_METRICS_INVALID' }),
    );
    expect(() => normalizeMetrics({ nested: { auc: 1 } })).toThrow();
  });

  it('객체가 아니면 거부한다', () => {
    expect(() => normalizeMetrics([0.8])).toThrow();
    expect(() => normalizeMetrics('auc=0.8')).toThrow();
    expect(() => normalizeMetrics(null)).toThrow();
  });
});
