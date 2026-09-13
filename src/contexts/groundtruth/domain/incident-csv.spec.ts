import { INCIDENT_CSV_COLUMNS, MAX_CSV_ROWS, parseIncidentCsv } from './incident-csv';

/**
 * 쏘임 사고 CSV 파싱.
 *
 * 이 파서가 받는 것은 **기관 담당자가 보내 준 엑셀**이다. 그래서 여기서 지키는 것은
 * 관대함이 아니라 **틀린 줄을 조용히 고쳐 주지 않는 것**이다 — 사고 기록은 정확도의
 * 근거이고, 추측으로 채우면 그 추측이 정답 데이터가 된다.
 *
 * 동시에 **한 줄 때문에 전부 거부하지도 않는다.** 100줄 중 3줄이 틀렸다고 전부 막으면
 * 담당자는 파일 전체를 다시 뒤져야 한다.
 */
describe('쏘임 사고 CSV', () => {
  const HEADER = 'beach_id,occurred_at,source,severity,patient_count,external_ref,note';

  it('정상 줄을 읽는다', () => {
    const result = parseIncidentCsv(
      `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,moderate,2,F-1,오후 구조`,
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      lineNumber: 1,
      beachId: 3,
      source: 'emergency_call',
      severity: 'moderate',
      patientCount: 2,
      externalRef: 'F-1',
      note: '오후 구조',
    });
  });

  it('열 순서가 달라도 이름으로 찾는다 — 엑셀에서 열이 밀리는 일이 흔하다', () => {
    const result = parseIncidentCsv(
      'severity,patient_count,beach_id,source,occurred_at\nmild,1,5,coast_guard,2026-08-02T10:00:00+09:00',
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ beachId: 5, severity: 'mild', patientCount: 1 });
  });

  describe('틀린 줄을 고쳐 주지 않는다', () => {
    it.each([
      ['해변 번호가 숫자가 아니다', '함덕,2026-08-01T14:30:00+09:00,emergency_call,mild,1', 'beach_id'],
      ['날짜를 읽을 수 없다', '3,어제,emergency_call,mild,1', 'occurred_at'],
      ['출처가 계약 밖이다', '3,2026-08-01T14:30:00+09:00,병원,mild,1', 'source'],
      ['중증도가 계약 밖이다', '3,2026-08-01T14:30:00+09:00,emergency_call,조금,1', 'severity'],
      ['환자 수가 0 이다', '3,2026-08-01T14:30:00+09:00,emergency_call,mild,0', 'patient_count'],
    ])('%s → 그 줄만 실패한다', (_label, row, expectedField) => {
      const result = parseIncidentCsv(`${HEADER}\n${row}`);

      expect(result.rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toContain(expectedField);
    });

    it('오류에 줄 번호와 원문을 함께 준다 — 파일에서 찾을 수 있어야 한다', () => {
      const result = parseIncidentCsv(
        `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1\n9,언제,emergency_call,mild,1`,
      );

      expect(result.errors[0].lineNumber).toBe(2);
      expect(result.errors[0].raw).toContain('언제');
    });
  });

  it('한 줄이 틀려도 나머지는 저장한다', () => {
    const result = parseIncidentCsv(
      `${HEADER}\n` +
        '3,2026-08-01T14:30:00+09:00,emergency_call,mild,1\n' +
        'x,2026-08-01T14:30:00+09:00,emergency_call,mild,1\n' +
        '5,2026-08-02T09:00:00+09:00,coast_guard,severe,3',
    );

    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });

  describe('머리글', () => {
    it('필수 열이 없으면 아무것도 읽지 않는다 — 열이 밀린 파일을 절반만 넣으면 안 된다', () => {
      const result = parseIncidentCsv('beach_id,occurred_at\n3,2026-08-01T14:30:00+09:00');

      expect(result.rows).toHaveLength(0);
      expect(result.errors[0].reason).toContain('source');
    });

    it('무엇이 필요한지 알려준다', () => {
      const result = parseIncidentCsv('beach_id\n3');

      for (const column of INCIDENT_CSV_COLUMNS) {
        expect(result.errors[0].reason).toContain(column);
      }
    });

    it('대소문자와 공백을 다듬는다', () => {
      const result = parseIncidentCsv(
        ' Beach_ID , Occurred_At , Source , Severity , Patient_Count \n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1',
      );

      expect(result.errors).toHaveLength(0);
    });
  });

  describe('따옴표', () => {
    it('비고란의 쉼표를 지킨다', () => {
      const result = parseIncidentCsv(
        `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1,F-1,"오전, 오후 각 1건"`,
      );

      expect(result.rows[0].note).toBe('오전, 오후 각 1건');
    });

    it('따옴표 두 개는 따옴표 한 개다 — 엑셀이 그렇게 내보낸다', () => {
      const result = parseIncidentCsv(
        `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1,F-1,"\\"해파리\\" 확인"`.replace(
          /\\/g,
          '',
        ),
      );

      expect(result.rows[0].note).toContain('해파리');
    });
  });

  describe('빈 값', () => {
    it('비어 있는 external_ref 는 null 이다 — 빈 값끼리 중복으로 잡히면 안 된다', () => {
      const result = parseIncidentCsv(
        `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1,,`,
      );

      expect(result.rows[0].externalRef).toBeNull();
      expect(result.rows[0].note).toBeNull();
    });

    it('빈 파일은 오류다', () => {
      expect(parseIncidentCsv('   ').errors[0].reason).toContain('비어');
    });

    it('빈 줄은 건너뛴다 — 엑셀이 끝에 붙이는 개행 때문에 실패하면 안 된다', () => {
      const result = parseIncidentCsv(
        `${HEADER}\n3,2026-08-01T14:30:00+09:00,emergency_call,mild,1\n\n\n`,
      );

      expect(result.rows).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  it(`${MAX_CSV_ROWS}줄을 넘으면 거부한다 — 나눠 올리라고 알려준다`, () => {
    const body = Array.from(
      { length: MAX_CSV_ROWS + 1 },
      () => '3,2026-08-01T14:30:00+09:00,emergency_call,mild,1',
    ).join('\n');

    const result = parseIncidentCsv(`${HEADER}\n${body}`);

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].reason).toContain('나눠서');
  });
});
