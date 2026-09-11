import { ValidationError } from '@shared/kernel/domain-error';
import { RiskLevel } from '@shared/kernel/risk-level';
import {
  MANUAL_OVERRIDE_RULE_CODE,
  MAX_OVERRIDE_HOURS,
  RiskOverride,
} from './risk-override';

/**
 * 운영자 수동 등급 상향.
 *
 * 이 기능은 **사람이 시민에게 보이는 위험 단계를 직접 바꾸는** 유일한 자리다. 그래서 여기서
 * 지키는 것은 기능이 되는지가 아니라 **할 수 없어야 할 일이 막히는지**다.
 *
 *   · 단계를 **내릴 수 없다**  — 잘못 내리면 사람이 물에 들어간다
 *   · **기한 없이** 둘 수 없다 — 아무도 기억하지 않는 영구 상태가 된다
 *   · **사유 없이** 올릴 수 없다 — 나중에 해제 판단을 할 수 없다
 */
describe('수동 등급 상향', () => {
  const NOW = new Date('2026-09-12T00:00:00.000Z');

  function create(overrides: Partial<Parameters<typeof RiskOverride.create>[0]> = {}) {
    return RiskOverride.create({
      beachId: 1,
      minRiskLevel: 'danger',
      reason: '현장 육안 확인 — 해파리 대량 표착',
      createdBy: 7,
      durationHours: 6,
      now: NOW,
      ...overrides,
    });
  }

  describe('내릴 수 없다 — 이 기능에 하향은 없다', () => {
    it("'safe' 로는 상향할 수 없다", () => {
      // 동작만 보면 무해하다(아무것도 올리지 못한다). 막는 이유는 오해다 —
      // 운영자는 이걸 "안전으로 내렸다" 로 읽는다.
      expect(() => create({ minRiskLevel: 'safe' })).toThrow(ValidationError);
    });

    it("'safe' 거부 메시지가 **내리는 기능이 없다는 사실**을 알려준다", () => {
      try {
        create({ minRiskLevel: 'safe' });
        throw new Error('여기 오면 안 된다');
      } catch (error) {
        expect((error as ValidationError).code).toBe('OVERRIDE_LEVEL_NOT_RAISING');
        expect((error as ValidationError).message).toContain('올리기만');
      }
    });

    it('엔진에 넘기는 트리거는 최소 단계 보장이다 — 구조적으로 낮출 수 없다', () => {
      // 엔진은 maxRiskLevel(산출값, 보장값)을 쓴다. 산출이 더 높으면 상향은 아무 효과가 없고,
      // 그게 맞다 — 사람이 "위험" 을 지시했는데 엔진이 "매우 위험" 이면 높은 쪽이 남아야 한다.
      const trigger = create({ minRiskLevel: 'caution' }).toMinLevelTrigger();

      expect(trigger).toEqual({ ruleCode: MANUAL_OVERRIDE_RULE_CODE, level: 'caution' });
    });

    it.each<RiskLevel>(['caution', 'danger', 'severe'])('%s 로는 올릴 수 있다', (level) => {
      expect(() => create({ minRiskLevel: level })).not.toThrow();
    });

    it('계약에 없는 단계는 거부한다', () => {
      expect(() => create({ minRiskLevel: 'VERY_DANGEROUS' })).toThrow(ValidationError);
    });
  });

  describe('기한이 반드시 있다', () => {
    it('기간만큼 뒤에 만료된다', () => {
      const override = create({ durationHours: 6 });
      expect(override.expiresAt.toISOString()).toBe('2026-09-12T06:00:00.000Z');
    });

    it(`${MAX_OVERRIDE_HOURS}시간을 넘길 수 없다 — 영구 상향을 막는다`, () => {
      expect(() => create({ durationHours: MAX_OVERRIDE_HOURS + 1 })).toThrow(ValidationError);
    });

    it('상한 거부 메시지가 왜 제한하는지 알려준다', () => {
      try {
        create({ durationHours: 999 });
        throw new Error('여기 오면 안 된다');
      } catch (error) {
        expect((error as ValidationError).message).toContain('다시 판단');
      }
    });

    it('상한 자체는 허용한다', () => {
      expect(() => create({ durationHours: MAX_OVERRIDE_HOURS })).not.toThrow();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      '기간 %p 는 거부한다',
      (durationHours) => {
        expect(() => create({ durationHours })).toThrow(ValidationError);
      },
    );
  });

  describe('사유가 반드시 있다', () => {
    it('빈 사유는 거부한다', () => {
      expect(() => create({ reason: '   ' })).toThrow(ValidationError);
    });

    it('거부 메시지가 왜 필요한지 알려준다 — 나중에 해제 판단을 못 한다', () => {
      try {
        create({ reason: '' });
        throw new Error('여기 오면 안 된다');
      } catch (error) {
        expect((error as ValidationError).message).toContain('해제');
      }
    });

    it('앞뒤 공백을 다듬는다', () => {
      expect(create({ reason: '  현장 확인  ' }).snapshot().reason).toBe('현장 확인');
    });

    it('300자를 넘으면 거부한다 — 잘라 저장하면 근거가 잘린다', () => {
      // 공개 코멘트와 달리 여기서는 자르지 않는다. 사유는 나중에 판단의 근거가 되는 글이라
      // 조용히 잘리면 문장이 끊긴 채 남는다.
      expect(() => create({ reason: '가'.repeat(301) })).toThrow(ValidationError);
    });
  });

  describe('유효 기간 판정', () => {
    it('시작 시각에는 유효하다', () => {
      expect(create().isActiveAt(NOW)).toBe(true);
    });

    it('만료 직전에는 유효하다', () => {
      const override = create({ durationHours: 6 });
      expect(override.isActiveAt(new Date(NOW.getTime() + 6 * 3_600_000 - 1))).toBe(true);
    });

    it('만료 시각에는 유효하지 않다 — 경계는 만료로 본다', () => {
      const override = create({ durationHours: 6 });
      expect(override.isActiveAt(new Date(NOW.getTime() + 6 * 3_600_000))).toBe(false);
    });

    it('시작 전에는 유효하지 않다', () => {
      expect(create().isActiveAt(new Date(NOW.getTime() - 1))).toBe(false);
    });

    /**
     * 미래 시각으로 묻는 이유 — 24h·72h **예보**에 이 상향을 얹을지 판단해야 한다.
     * 6시간 뒤 만료되는 상향을 72시간 예보에 적용하면 그 예보는 거짓이 된다.
     */
    it('만료 뒤의 예보 시점에는 적용되지 않는다', () => {
      const override = create({ durationHours: 6 });
      const in24h = new Date(NOW.getTime() + 24 * 3_600_000);

      expect(override.isActiveAt(NOW)).toBe(true);
      expect(override.isActiveAt(in24h)).toBe(false);
    });

    it('기간이 넉넉하면 예보 시점에도 적용된다', () => {
      const override = create({ durationHours: MAX_OVERRIDE_HOURS });
      expect(override.isActiveAt(new Date(NOW.getTime() + 24 * 3_600_000))).toBe(true);
    });
  });

  describe('해제', () => {
    it('해제하면 그 시점부터 유효하지 않다', () => {
      const override = create({ durationHours: 24 });
      const releasedAt = new Date(NOW.getTime() + 3_600_000);

      override.release(9, releasedAt);

      expect(override.isActiveAt(new Date(releasedAt.getTime() - 1))).toBe(true);
      expect(override.isActiveAt(releasedAt)).toBe(false);
    });

    it('이미 해제됐으면 아무 일도 하지 않는다 — 두 사람이 동시에 눌러도 오류가 아니다', () => {
      const override = create();
      const first = new Date(NOW.getTime() + 1000);

      override.release(9, first);
      override.release(10, new Date(NOW.getTime() + 2000));

      expect(override.releasedAt?.getTime()).toBe(first.getTime());
      expect(override.snapshot().releasedBy).toBe(9);
    });
  });

  it('요약에 단계와 만료 시각이 들어간다 — 감사 로그에서 이것만 봐도 판단된다', () => {
    const described = create({ minRiskLevel: 'severe', durationHours: 6 }).describe();

    expect(described).toContain('매우 위험');
    expect(described).toContain('2026-09-12T06:00:00');
  });

  describe('초 단위 내림 — DB 반올림 때문에 시작이 미래가 되면 안 된다', () => {
    /**
     * `starts_at` 은 MySQL DATETIME(0) 이고 MySQL 은 소수점을 **반올림한다**
     * (12:34:56.789 → 12:34:57, 실측 확인). 저장값이 실제 생성 시각보다 늦어지면
     * 저장 직후 도는 재산출이 `starts_at <= now` 를 만족하지 못해 이 상향을 못 본다.
     * 0.5초 차이로 절반쯤 조용히 실패하는 결함이라 실 DB 에서야 드러났다.
     */
    it('시작 시각의 소수점을 버린다', () => {
      const withMillis = new Date('2026-09-12T00:00:00.789Z');
      const override = create({ now: withMillis });

      expect(override.snapshot().startsAt.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    });

    it('저장값이 생성 시각보다 늦어지지 않는다 — 이것이 지키려는 성질이다', () => {
      const withMillis = new Date('2026-09-12T00:00:00.999Z');
      const override = create({ now: withMillis });

      expect(override.snapshot().startsAt.getTime()).toBeLessThanOrEqual(withMillis.getTime());
    });

    it('만료도 내린 시작 시각을 기준으로 계산한다 — 기간이 어긋나면 안 된다', () => {
      const override = create({ now: new Date('2026-09-12T00:00:00.789Z'), durationHours: 6 });

      expect(override.expiresAt.toISOString()).toBe('2026-09-12T06:00:00.000Z');
    });

    it('해제 시각도 내린다', () => {
      const override = create();
      override.release(9, new Date('2026-09-12T01:00:00.500Z'));

      expect(override.releasedAt?.toISOString()).toBe('2026-09-12T01:00:00.000Z');
    });
  });
});
