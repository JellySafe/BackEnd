import { DomainError } from '@shared/kernel/domain-error';
import { FieldObservation, NewFieldObservationInput } from './field-observation';
import { OBSERVATION_SOURCES } from './groundtruth-enums';

/**
 * 현장 관측은 **부재를 기록할 수 있는 유일한 입력원**이다.
 *
 * 시민 제보는 본 사람만 올리므로 "제보 없음" 이 "해파리 없음" 을 뜻하지 않는다. 그 데이터로는
 * 오경보를 셀 수 없다. 여기서 지키는 불변식은 전부 **집계가 조용히 틀어지는 것**을 막는 데 있다.
 */
describe('FieldObservation', () => {
  const now = new Date('2026-08-20T10:00:00Z');
  const base: NewFieldObservationInput = {
    beachId: 3,
    observedAt: new Date('2026-08-20T09:00:00Z'),
    source: 'lifeguard',
    jellyfishPresent: false,
  };

  describe('부재 관측', () => {
    it('해파리를 못 봤다는 기록도 유효하다 — 이게 정답 데이터의 절반이다', () => {
      const observation = FieldObservation.create(base, now);
      expect(observation.jellyfishPresent).toBe(false);
      expect(observation.densityLevel).toBeNull();
    });

    it('없었다면서 밀도를 적으면 거부한다', () => {
      expect(() =>
        FieldObservation.create({ ...base, jellyfishPresent: false, densityLevel: 'low' }, now),
      ).toThrow(/밀도를 기록할 수 없습니다/);
    });

    it('없었다면서 개체 수를 적으면 거부한다', () => {
      expect(() =>
        FieldObservation.create({ ...base, jellyfishPresent: false, estimatedCount: 5 }, now),
      ).toThrow(/개체 수를 기록할 수 없습니다/);
    });

    it('없었고 개체 수 0 은 허용한다 — 모순이 아니다', () => {
      expect(() =>
        FieldObservation.create({ ...base, jellyfishPresent: false, estimatedCount: 0 }, now),
      ).not.toThrow();
    });
  });

  describe('출현 관측', () => {
    const present: NewFieldObservationInput = {
      ...base,
      jellyfishPresent: true,
      densityLevel: 'high',
    };

    it('밀도와 함께 기록된다', () => {
      expect(FieldObservation.create(present, now).densityLevel).toBe('high');
    });

    it('봤다면서 밀도를 비우면 거부한다 — 밀도 없는 출현은 위험도 판정에 쓸 수 없다', () => {
      expect(() =>
        FieldObservation.create({ ...present, densityLevel: null }, now),
      ).toThrow(/밀도\(저\/중\/고\)를 함께 기록/);
    });

    it.each(['LOW', 'heavy', ''])('허용되지 않은 밀도 %p 는 거부한다', (density) => {
      expect(() =>
        FieldObservation.create(
          { ...present, densityLevel: density as 'low' },
          now,
        ),
      ).toThrow(DomainError);
    });
  });

  describe('관측 시각', () => {
    it('미래 시각은 거부한다 — 그날 대조에서 조용히 빠진다', () => {
      const future = new Date(now.getTime() + 60 * 60_000);
      expect(() => FieldObservation.create({ ...base, observedAt: future }, now)).toThrow(
        /미래 시각/,
      );
    });

    it('시계 오차 정도(5분 이내)는 허용한다', () => {
      const slightly = new Date(now.getTime() + 3 * 60_000);
      expect(() => FieldObservation.create({ ...base, observedAt: slightly }, now)).not.toThrow();
    });

    it('올바르지 않은 Date 는 거부한다', () => {
      expect(() =>
        FieldObservation.create({ ...base, observedAt: new Date('없는날짜') }, now),
      ).toThrow(/관측 시각/);
    });
  });

  describe('출처', () => {
    it.each([...OBSERVATION_SOURCES])('%s 는 허용된다', (source) => {
      expect(() => FieldObservation.create({ ...base, source }, now)).not.toThrow();
    });

    it('시민 제보는 출처로 받지 않는다 — 부재를 알 수 없는 입력원이라 성격이 다르다', () => {
      expect(() =>
        FieldObservation.create({ ...base, source: 'citizen' as 'lifeguard' }, now),
      ).toThrow(DomainError);
    });
  });

  describe('필수값과 상한', () => {
    it.each([0, -1])('해변 식별자 %p 는 거부한다', (beachId) => {
      expect(() => FieldObservation.create({ ...base, beachId }, now)).toThrow(/해변/);
    });

    it('개체 수는 음수·소수를 거부한다', () => {
      const present = { ...base, jellyfishPresent: true, densityLevel: 'low' as const };
      expect(() => FieldObservation.create({ ...present, estimatedCount: -1 }, now)).toThrow();
      expect(() => FieldObservation.create({ ...present, estimatedCount: 1.5 }, now)).toThrow();
    });

    it('메모 500자 초과는 거부한다', () => {
      expect(() => FieldObservation.create({ ...base, note: 'a'.repeat(501) }, now)).toThrow(
        /메모/,
      );
    });

    it('공백만 있는 메모는 null 로 접는다', () => {
      expect(FieldObservation.create({ ...base, note: '  ' }, now).snapshot().note).toBeNull();
    });
  });

  describe('복원', () => {
    it('저장된 행은 검증 없이 재구성한다', () => {
      const restored = FieldObservation.reconstitute({
        id: 7,
        beachId: 3,
        observedAt: now,
        source: 'lifeguard',
        observerId: null,
        observerName: null,
        jellyfishPresent: false,
        densityLevel: null,
        speciesId: null,
        estimatedCount: null,
        note: null,
      });
      expect(restored.id).toBe(7);
    });
  });
});
