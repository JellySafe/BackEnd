/**
 * 관측 항목과 그것이 먹이는 위험 요인.
 *
 * ── 왜 이 표가 필요한가 ──────────────────────────────────────────────────────────────
 * 관측소가 **연결돼 있고 신선해도, 그 관측소가 특정 값을 아예 주지 않을 수 있다.**
 * 그리고 그 사실이 어디에도 드러나지 않았다.
 *
 * 실제로 겪은 것 — 제주 해변 12곳 중 11곳이 파고부이·해양기상부이에 붙어 있는데,
 * 그 관측소들은 **유향·유속을 관측하지 않는다.** 그래서 CURRENT_INFLOW 가 영원히 결측이고,
 * 신뢰도가 구조적으로 'medium' 에서 멈춘다. 화면에는 "medium" 이라고만 나오므로 운영자는
 * **수집이 밀렸나 보다** 하고 기다리게 된다. 기다려도 오지 않는다 — 그 값은 애초에 없다.
 *
 * "지금 안 온다" 와 "여기서는 원래 안 온다" 는 운영자가 해야 할 일이 완전히 다르다.
 * 앞은 수집을 고치는 일이고, 뒤는 **관측소를 늘리거나 포기하는 일**이다.
 *
 * ⚠️ 이 표는 관측 항목과 룰 코드를 손으로 잇는다. 룰을 추가하면 여기도 고쳐야 하고,
 *    잊으면 그 룰의 결측 이유가 진단에서 빠진다. 자동으로 잇지 않은 이유는 룰이 여러
 *    항목을 함께 쓰기 때문이다(CURRENT_INFLOW 는 유향과 유속을 둘 다 본다).
 */

/** 진단이 다루는 관측 항목. observations 테이블 컬럼과 1:1 이다. */
export const MEASUREMENT_CODES = [
  'water_temp',
  'wave_height',
  'wind',
  'current',
  'salinity',
] as const;

export type MeasurementCode = (typeof MEASUREMENT_CODES)[number];

export interface MeasurementSpec {
  code: MeasurementCode;
  label: string;
  /** observations 의 어느 컬럼이 채워져야 "있다" 인가. 하나라도 있으면 있는 것으로 본다. */
  columns: readonly string[];
  /** 이 항목이 없으면 평가할 수 없는 위험 요인. */
  feeds: readonly string[];
}

export const MEASUREMENT_SPECS: readonly MeasurementSpec[] = [
  {
    code: 'water_temp',
    label: '수온',
    columns: ['water_temp'],
    // 최근 3일 상승폭을 보는 TEMP_UP 과 7일 평균 TEMP_7D_AVG 가 같은 값을 쓴다.
    feeds: ['TEMP_UP', 'TEMP_7D_AVG'],
  },
  { code: 'wave_height', label: '파고', columns: ['wave_height'], feeds: ['WAVE_HIGH'] },
  {
    code: 'wind',
    label: '풍향·풍속',
    // 방향만 있고 속도가 없으면 유입 판정을 못 한다. 둘 다 필요하지만, 진단에서는
    // "이 관측소가 바람을 재는가" 를 묻는 것이므로 하나라도 있으면 있는 것으로 본다.
    columns: ['wind_direction', 'wind_speed'],
    feeds: ['WIND_INFLOW'],
  },
  {
    code: 'current',
    label: '유향·유속',
    columns: ['current_direction', 'current_speed'],
    feeds: ['CURRENT_INFLOW'],
  },
  {
    code: 'salinity',
    label: '염분',
    columns: ['salinity'],
    // 지금은 어떤 룰도 염분을 쓰지 않는다. 그래도 진단에 남기는 이유 — 해파리 대량발생과
    // 저염분수 유입의 관계는 알려져 있고, 룰을 넣으려 할 때 **어느 해변에서 잴 수 있는지**
    // 부터 알아야 한다. 지금 그 답은 중문 한 곳뿐이다.
    feeds: [],
  },
];

/** 관측 항목 한 가지의 수급 상태. */
export interface MeasurementCoverage {
  code: MeasurementCode;
  label: string;
  /** 조회 구간 안에 이 값을 준 관측소가 하나라도 있었는가. */
  available: boolean;
  /** 그 값을 준 관측소 코드들. 비어 있으면 아무도 주지 않는다. */
  providedBy: string[];
  /** 마지막으로 값이 들어온 시각. 없으면 null. */
  lastValueAt: Date | null;
  /** 이 항목이 없어서 평가되지 못하는 위험 요인. */
  blockedFactors: string[];
}
