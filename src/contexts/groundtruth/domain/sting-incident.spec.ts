import { DomainError } from '@shared/kernel/domain-error';
import { INCIDENT_SOURCES, STING_SEVERITIES } from './groundtruth-enums';
import { NewStingIncidentInput, StingIncident } from './sting-incident';

/**
 * 쏘임 사고는 **가장 강한 정답**이다. 현장 관측은 "위험해 보였다" 이고 이건 실제로 피해가 났다.
 *
 * 그래서 여기 들어온 한 건이 곧 "그날 그 해변은 위험했다" 로 판정된다(prediction-outcome).
 * 0명짜리 행이나 미래 날짜가 새어 들어가면 그 판정이 통째로 오염된다.
 */
describe('StingIncident', () => {
  const now = new Date('2026-08-20T10:00:00Z');
  const base: NewStingIncidentInput = {
    beachId: 3,
    occurredAt: new Date('2026-08-20T09:30:00Z'),
    source: 'lifeguard',
    severity: 'mild',
    patientCount: 1,
  };

  describe('기록 생성', () => {
    it('필수값이 있으면 만들어진다', () => {
      const incident = StingIncident.create(base, now);
      expect(incident.beachId).toBe(3);
      expect(incident.patientCount).toBe(1);
      expect(incident.severity).toBe('mild');
    });

    it.each([...INCIDENT_SOURCES])('신고 경로 %s 는 허용된다', (source) => {
      expect(() => StingIncident.create({ ...base, source }, now)).not.toThrow();
    });

    it.each([...STING_SEVERITIES])('피해 정도 %s 는 허용된다', (severity) => {
      expect(() => StingIncident.create({ ...base, severity }, now)).not.toThrow();
    });

    it.each(['119', 'unknown', ''])('허용되지 않은 신고 경로 %p 는 거부한다', (source) => {
      expect(() =>
        StingIncident.create({ ...base, source: source as 'lifeguard' }, now),
      ).toThrow(DomainError);
    });

    it('허용되지 않은 피해 정도는 거부한다', () => {
      expect(() =>
        StingIncident.create({ ...base, severity: 'critical' as 'mild' }, now),
      ).toThrow(DomainError);
    });
  });

  describe('피해자 수', () => {
    it.each([0, -1])('%p 명은 거부한다 — 0명짜리 사고는 사고가 아닌데 "위험했다" 로 세어진다', (patientCount) => {
      expect(() => StingIncident.create({ ...base, patientCount }, now)).toThrow(
        /1명 이상/,
      );
    });

    it('소수는 거부한다', () => {
      expect(() => StingIncident.create({ ...base, patientCount: 1.5 }, now)).toThrow();
    });

    it('비정상적으로 큰 값은 거부한다 — 집계 값을 잘못 넣은 것이다', () => {
      expect(() => StingIncident.create({ ...base, patientCount: 100_000 }, now)).toThrow(
        /비정상/,
      );
    });

    it('여러 명도 한 건으로 기록할 수 있다', () => {
      expect(StingIncident.create({ ...base, patientCount: 7 }, now).patientCount).toBe(7);
    });
  });

  describe('사고 시각', () => {
    it('미래 시각은 거부한다', () => {
      const future = new Date(now.getTime() + 60 * 60_000);
      expect(() => StingIncident.create({ ...base, occurredAt: future }, now)).toThrow(
        /미래 시각/,
      );
    });

    it('시계 오차 정도(5분 이내)는 허용한다', () => {
      const slightly = new Date(now.getTime() + 3 * 60_000);
      expect(() => StingIncident.create({ ...base, occurredAt: slightly }, now)).not.toThrow();
    });

    it('과거 시각은 당연히 허용한다 — 119 연계는 늦게 들어온다', () => {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
      expect(() => StingIncident.create({ ...base, occurredAt: yesterday }, now)).not.toThrow();
    });
  });

  describe('중복 유입 대비', () => {
    it('외부 식별자를 남긴다 — 같은 사고가 안전요원과 119 양쪽에서 들어올 수 있다', () => {
      const incident = StingIncident.create({ ...base, externalRef: 'FIRE-2026-0820-0031' }, now);
      expect(incident.externalRef).toBe('FIRE-2026-0820-0031');
    });

    it('공백만 있는 식별자는 null 로 접는다', () => {
      expect(StingIncident.create({ ...base, externalRef: '  ' }, now).externalRef).toBeNull();
    });

    it('식별자 100자 초과는 거부한다', () => {
      expect(() =>
        StingIncident.create({ ...base, externalRef: 'x'.repeat(101) }, now),
      ).toThrow(/외부 식별자/);
    });
  });

  describe('개인정보', () => {
    it('스키마에 환자 신원 필드가 없다 — 없으면 실수로도 들어오지 않는다', () => {
      const snapshot = StingIncident.create(base, now).snapshot();
      const keys = Object.keys(snapshot);
      for (const forbidden of ['patientName', 'phone', 'residentId', 'diagnosis']) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });
});
