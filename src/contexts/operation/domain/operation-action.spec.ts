import { DomainError } from '@shared/kernel/domain-error';
import { OperationAction, NewOperationActionInput } from './operation-action';
import { OPERATION_STATUSES, isOperationStatus } from './operation-enums';

/**
 * 운영 대응 기록 (ADM-007).
 *
 * ── 여기가 "상태 머신" 이 아닌 것이 의도다 ───────────────────────────────────────────
 * 이 애그리거트는 전이 규칙을 갖지 않는다. `entry_ban` 다음에 `normal` 이 와도 막지 않는다.
 * RISK-003 대로 **운영 상태는 위험 단계와 별개 축이고, 사람이 판단해 기록하는 값**이기
 * 때문이다. 통제를 풀지 말지는 현장 안전요원이 정하며, 시스템이 "그 전이는 안 된다" 고
 * 막으면 실제로 일어난 일을 기록하지 못하게 된다.
 *
 * 그래서 도메인이 지키는 것은 전이가 아니라 **기록의 성립 조건**이다 — 어느 해변에 대해,
 * 누가, 계약된 상태값 중 무엇을 기록했는가.
 */
describe('OperationAction', () => {
  const now = new Date('2026-08-20T10:00:00Z');
  const valid: NewOperationActionInput = {
    beachId: 3,
    operationStatus: 'entry_caution',
    createdBy: 5,
  };

  describe('상태값 계약', () => {
    it.each([...OPERATION_STATUSES])('%s 는 허용된 상태다', (status) => {
      expect(isOperationStatus(status)).toBe(true);
    });

    it.each(['ENTRY_BAN', 'entry-ban', 'closed', ''])(
      '%p 는 허용되지 않는다 — DB 는 utf8mb4_bin 이라 대소문자·표기가 다르면 다른 값이다',
      (status) => {
        expect(isOperationStatus(status)).toBe(false);
      },
    );

    it.each([undefined, null, 42, {}])('문자열이 아닌 %p 도 거부한다', (status) => {
      expect(isOperationStatus(status)).toBe(false);
    });

    it('상태는 8종이다 — 화면 선택지와 DB CHECK 가 같은 목록을 본다', () => {
      expect(OPERATION_STATUSES).toHaveLength(8);
    });
  });

  describe('기록 생성', () => {
    it('필수값이 있으면 만들어진다', () => {
      const action = OperationAction.create(valid, now);
      expect(action.beachId).toBe(3);
      expect(action.operationStatus).toBe('entry_caution');
      expect(action.createdBy).toBe(5);
      expect(action.snapshot().createdAt).toBe(now);
    });

    it('기록 시각은 주입받는다 — 도메인이 시계를 직접 읽지 않아야 테스트가 결정적이다', () => {
      const other = new Date('2020-01-01T00:00:00Z');
      expect(OperationAction.create(valid, other).snapshot().createdAt).toBe(other);
    });

    it('대상 해변이 없으면 거부한다', () => {
      const input = { ...valid, beachId: null } as unknown as NewOperationActionInput;
      expect(() => OperationAction.create(input, now)).toThrow(/해변/);
    });

    it('허용되지 않은 상태는 거부한다', () => {
      const input = { ...valid, operationStatus: 'closed' } as unknown as NewOperationActionInput;
      expect(() => OperationAction.create(input, now)).toThrow(DomainError);
    });

    it('기록자가 없으면 거부한다 — 누가 통제를 걸었는지 남지 않으면 기록의 의미가 없다', () => {
      const input = { ...valid, createdBy: null } as unknown as NewOperationActionInput;
      expect(() => OperationAction.create(input, now)).toThrow(/기록자/);
    });
  });

  describe('선택 입력', () => {
    it('대응 유형·메모는 없어도 된다', () => {
      const snapshot = OperationAction.create(valid, now).snapshot();
      expect(snapshot.actionType).toBeNull();
      expect(snapshot.memo).toBeNull();
    });

    it('공백만 있는 메모는 null 로 접는다 — 빈 문자열과 부재를 이중으로 표현하지 않는다', () => {
      const action = OperationAction.create({ ...valid, memo: '   ' }, now);
      expect(action.memo).toBeNull();
    });

    it('메모의 앞뒤 공백을 정리한다', () => {
      const action = OperationAction.create({ ...valid, memo: '  구역 통제  ' }, now);
      expect(action.memo).toBe('구역 통제');
    });

    it('대응 유형 50자까지 허용하고 넘으면 거부한다 — DB 컬럼 상한이다', () => {
      expect(() =>
        OperationAction.create({ ...valid, actionType: 'a'.repeat(50) }, now),
      ).not.toThrow();
      expect(() =>
        OperationAction.create({ ...valid, actionType: 'a'.repeat(51) }, now),
      ).toThrow(/대응 유형/);
    });

    it('메모 500자까지 허용하고 넘으면 거부한다', () => {
      expect(() => OperationAction.create({ ...valid, memo: 'a'.repeat(500) }, now)).not.toThrow();
      expect(() => OperationAction.create({ ...valid, memo: 'a'.repeat(501) }, now)).toThrow(
        /메모/,
      );
    });

    it('길이는 공백을 정리한 뒤에 잰다', () => {
      const memo = `  ${'a'.repeat(500)}  `;
      expect(() => OperationAction.create({ ...valid, memo }, now)).not.toThrow();
    });

    it('위험도·권고 연결은 없어도 된다 — 위험도와 무관하게 기록할 수 있어야 한다(RISK-003)', () => {
      const snapshot = OperationAction.create(valid, now).snapshot();
      expect(snapshot.riskScoreId).toBeNull();
      expect(snapshot.recommendationId).toBeNull();
    });
  });

  describe('전이를 막지 않는다', () => {
    it.each([
      ['입수 금지 → 정상 운영', 'entry_ban', 'normal'],
      ['운영 재개 → 입수 금지', 'resumed', 'entry_ban'],
    ] as const)('%s 도 기록할 수 있다 — 판단은 현장이 하고 시스템은 기록한다', (_l, from, to) => {
      expect(() =>
        OperationAction.create({ ...valid, operationStatus: from }, now),
      ).not.toThrow();
      expect(() => OperationAction.create({ ...valid, operationStatus: to }, now)).not.toThrow();
    });
  });

  describe('복원', () => {
    it('저장된 행은 검증 없이 재구성한다', () => {
      const action = OperationAction.reconstitute({
        id: 9,
        beachId: 3,
        riskScoreId: null,
        recommendationId: null,
        actionType: null,
        operationStatus: 'normal',
        memo: null,
        createdBy: 5,
        createdAt: now,
      });
      expect(action.id).toBe(9);
    });
  });

  describe('스냅샷', () => {
    it('복사본을 준다', () => {
      const action = OperationAction.create(valid, now);
      const snapshot = action.snapshot() as { beachId: number };
      snapshot.beachId = 999;
      expect(action.beachId).toBe(3);
    });
  });
});
