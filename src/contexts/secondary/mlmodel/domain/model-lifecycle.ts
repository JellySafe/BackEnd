import { UnprocessableError, ValidationError } from '@shared/kernel/domain-error';
import { ModelStatus, MODEL_STATUSES } from './ml-model';

/**
 * 모델 생애 관리 (EX-003 MLOps) — 상태 전이와 지표.
 *
 * ── 왜 전이 규칙이 필요한가 ──────────────────────────────────────────────────────────
 * 모델 상태는 **무엇이 지금 판단을 내리고 있는가**를 가리킨다. 학습 중인 모델이 곧바로 운영에
 * 올라가거나(검증 없이 판단이 바뀐다), 보관 처리한 모델이 슬그머니 다시 활성이 되면
 * "그때 그 판단은 어느 모델이 한 것인가" 에 답할 수 없게 된다. 안전 판단에서 그건 치명적이다.
 *
 * training → staging → active → archived 순서를 강제한다. 되돌리는 길은 archived 뿐이다.
 */
const ALLOWED_TRANSITIONS: Record<ModelStatus, readonly ModelStatus[]> = {
  // 학습 중. 끝나면 검증 단계로 올린다.
  training: ['staging', 'archived'],
  // 검증 단계(섀도 트래픽·오프라인 평가). 통과하면 활성, 아니면 보관.
  staging: ['active', 'archived'],
  // 운영. 새 모델로 교체되거나 문제가 생기면 보관으로 내린다.
  active: ['archived'],
  // 보관은 종착이다. 다시 쓰려면 **새 버전으로 등록**한다 — 같은 버전이 두 번 운영되면
  // 그 사이 어떤 판단이 어느 아티팩트에서 나왔는지 추적할 수 없다.
  archived: [],
};

export function assertModelTransition(from: ModelStatus, to: ModelStatus): void {
  if (!(MODEL_STATUSES as readonly string[]).includes(to)) {
    throw new ValidationError('MODEL_STATUS_INVALID', '알 수 없는 모델 상태입니다.', {
      allowed: MODEL_STATUSES,
    });
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new UnprocessableError(
      'MODEL_INVALID_TRANSITION',
      `모델 상태 전이가 허용되지 않습니다: ${from} → ${to}`,
      { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    );
  }
}

/**
 * 성능 지표. 자유 형식(JSON)이지만 **숫자만** 받는다.
 *
 * 문자열·객체를 섞어 두면 나중에 비교·집계가 불가능해진다("0.87" 과 0.87 이 섞이는 순간
 * 모니터링 화면은 둘을 다르게 다룬다). 이름은 자유롭게 두되(auc, recall, f1 …) 값은 수치로 고정한다.
 */
export function normalizeMetrics(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('MODEL_METRICS_INVALID', '성능 지표는 객체여야 합니다.');
  }

  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new ValidationError('MODEL_METRICS_INVALID', '성능 지표 값은 숫자여야 합니다.', {
        key,
        value,
      });
    }
    metrics[key] = num;
  }
  return metrics;
}
