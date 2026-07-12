import { DomainError, UnprocessableError, ValidationError } from '@shared/kernel/domain-error';
import { JellyfishReport, NewReportInput } from './jellyfish-report';

const NOW = new Date('2026-07-10T12:00:00Z');

/** 던져진 예외를 반환한다(안 던지면 undefined). jest-circus 에 fail() 이 없어 대체. */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function validInput(over: Partial<NewReportInput> = {}): NewReportInput {
  return {
    beachId: 1,
    reporterUserId: 10,
    reporterToken: null,
    lat: null,
    lng: null,
    imageUrl: 'https://cdn/img.jpg',
    reportType: 'general',
    occurredAt: new Date('2026-07-10T11:00:00Z'),
    ...over,
  };
}

describe('JellyfishReport.create (REPORT-001 불변식)', () => {
  it('정상 입력 → status=received 로 생성', () => {
    const report = JellyfishReport.create(validInput(), NOW);
    expect(report.status).toBe('received');
    expect(report.beachId).toBe(1);
    expect(report.reportType).toBe('general');
    const snap = report.snapshot();
    expect(snap.submittedAt).toEqual(NOW);
    expect(snap.aiResult).toBeNull();
    expect(snap.reflectedAt).toBeNull();
  });

  it('사진(imageUrl) 없으면 ValidationError REPORT_IMAGE_REQUIRED', () => {
    expect(() => JellyfishReport.create(validInput({ imageUrl: '   ' }), NOW)).toThrow(
      ValidationError,
    );
    const e = catchError(() => JellyfishReport.create(validInput({ imageUrl: '' }), NOW));
    expect((e as DomainError).code).toBe('REPORT_IMAGE_REQUIRED');
  });

  it('해변/GPS 모두 없으면 ValidationError REPORT_LOCATION_REQUIRED', () => {
    const e = catchError(() =>
      JellyfishReport.create(validInput({ beachId: null, lat: null, lng: null }), NOW),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as DomainError).code).toBe('REPORT_LOCATION_REQUIRED');
  });

  it('GPS 좌표만 있어도 위치 조건 충족', () => {
    const report = JellyfishReport.create(
      validInput({ beachId: null, lat: 35.1, lng: 129.1 }),
      NOW,
    );
    expect(report.status).toBe('received');
  });

  it('제보자(userId/token) 모두 없으면 ValidationError REPORT_REPORTER_REQUIRED', () => {
    const e = catchError(() =>
      JellyfishReport.create(validInput({ reporterUserId: null, reporterToken: '  ' }), NOW),
    );
    expect((e as DomainError).code).toBe('REPORT_REPORTER_REQUIRED');
  });

  it('익명 토큰만 있어도 제보자 조건 충족', () => {
    const report = JellyfishReport.create(
      validInput({ reporterUserId: null, reporterToken: 'anon-token' }),
      NOW,
    );
    expect(report.status).toBe('received');
  });

  it('발견 시각이 미래면 ValidationError REPORT_OCCURRED_FUTURE', () => {
    const e = catchError(() =>
      JellyfishReport.create(validInput({ occurredAt: new Date(NOW.getTime() + 1000) }), NOW),
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as DomainError).code).toBe('REPORT_OCCURRED_FUTURE');
  });

  it('발견 시각 == now 는 허용 (미래 아님)', () => {
    const report = JellyfishReport.create(validInput({ occurredAt: NOW }), NOW);
    expect(report.status).toBe('received');
  });
});

describe('JellyfishReport 상태 전이 (REPORT-002)', () => {
  function received(): JellyfishReport {
    return JellyfishReport.create(validInput(), NOW);
  }

  it('전체 정상 경로: received→ai_processing→ai_done→verified→reflected', () => {
    const r = received();
    r.startAiProcessing();
    expect(r.status).toBe('ai_processing');
    r.completeAi('toxic_suspected', 0.9);
    expect(r.status).toBe('ai_done');
    expect(r.aiResult).toBe('toxic_suspected');
    expect(r.aiConfidence).toBe(0.9);
    r.verify();
    expect(r.status).toBe('verified');
    r.markReflected(NOW);
    expect(r.status).toBe('reflected');
    expect(r.snapshot().reflectedAt).toEqual(NOW);
  });

  it('허용되지 않은 전이(received→verify)는 UnprocessableError', () => {
    const r = received();
    expect(() => r.verify()).toThrow(UnprocessableError);
    const e = catchError(() => r.verify());
    expect((e as DomainError).code).toBe('REPORT_INVALID_TRANSITION');
    expect((e as DomainError).kind).toBe('UNPROCESSABLE');
  });

  it('received 상태에서 곧바로 markReflected 불가', () => {
    expect(() => received().markReflected(NOW)).toThrow(UnprocessableError);
  });

  it('종결 상태(reflected)에서 추가 전이 불가', () => {
    const r = received();
    r.startAiProcessing();
    r.completeAi('normal', 0.5);
    r.verify();
    r.markReflected(NOW);
    expect(() => r.startAiProcessing()).toThrow(UnprocessableError);
  });
});

describe('JellyfishReport.reject / hold (ADM-009, REPORT-003)', () => {
  function atAiDone(): JellyfishReport {
    const r = JellyfishReport.create(validInput(), NOW);
    r.startAiProcessing();
    r.completeAi('unknown', null);
    return r;
  }

  it('사유와 함께 반려 → rejected', () => {
    const r = atAiDone();
    r.reject('not_jellyfish');
    expect(r.status).toBe('rejected');
  });

  it('duplicate 사유 + 원본 id → duplicateOfReportId 설정', () => {
    const r = atAiDone();
    r.reject('duplicate', 999);
    expect(r.status).toBe('rejected');
    expect(r.snapshot().duplicateOfReportId).toBe(999);
  });

  it('사유가 falsy 면 ValidationError REVIEW_REJECT_REASON_REQUIRED', () => {
    const r = atAiDone();
    // 도메인 규칙: 반려 사유 필수
    const e = catchError(() => r.reject(undefined as unknown as never));
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as DomainError).code).toBe('REVIEW_REJECT_REASON_REQUIRED');
    // 실패 시 상태는 그대로 ai_done 유지
    expect(r.status).toBe('ai_done');
  });

  it('보류(hold) 후 재검수(verify) 가능', () => {
    const r = atAiDone();
    r.hold();
    expect(r.status).toBe('hold');
    r.verify();
    expect(r.status).toBe('verified');
  });

  it('보류(hold) 후 반려(reject)도 가능', () => {
    const r = atAiDone();
    r.hold();
    r.reject('unclear');
    expect(r.status).toBe('rejected');
  });
});
