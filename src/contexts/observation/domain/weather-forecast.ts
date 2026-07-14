import { Id } from '@shared/kernel/id';

/**
 * 기상 예보 한 건 (weather_forecasts 한 행).
 *
 * 관측(observations)이 "지금 어떤가"라면 예보는 "앞으로 어떨 것인가"다.
 * 해상예보는 관측소가 아니라 **예보구역(reg)** 단위로 발표되므로 해변에 직접 붙인다.
 *
 * UNIQUE(beach_id, target_at) — 같은 대상 시각의 예보는 6시간마다 다시 발표되므로
 * **가장 최신 발표(base_at)로 덮어쓴다.**
 *
 * ── 단기 해상예보(fct_afs_do)가 주는 것과 주지 않는 것 ──────────────────────────────
 *  주는 것 : 파고(WH1~WH2 m), 풍속(S1~S2 m/s), 풍향(W1~W2, 16방위), 하늘상태(SKY), 강수유무(PREP)
 *  안 주는 것: **기온**(air_temp = null), **강수량 mm**(precipitation = null), **수온**
 *
 *  · precipitation 은 mm 컬럼인데 해상예보의 PREP 은 강수 '유무/형태' 코드(0/1)다.
 *    0/1 을 mm 로 저장하면 "강수량 1mm" 라는 거짓이 된다 → null 로 둔다.
 *  · 수온은 어떤 예보에도 없다. 위험도의 TEMP_UP/TEMP_7D_AVG 는 예보로 재평가할 수 없고
 *    현재 관측의 지속성으로만 근사한다(risk-horizon.ts 참고).
 */
export interface ForecastReading {
  /** 예보 대상 해변. */
  readonly beachId: Id;
  /** 발표 시각 (TM_FC, KST → UTC 인스턴트). */
  readonly baseAt: Date;
  /** 예보 대상 시각 (TM_EF, KST → UTC 인스턴트). 12시간 구간의 시작이다(MOD=A02). */
  readonly targetAt: Date;
  /** 파고 m. 범위 예보(WH1~WH2)의 대표값 — 산출 근거는 kma-marine-fcst.collector.ts 참고. */
  readonly waveHeight: number | null;
  /** 풍향 도 0~359. 16방위(W1~W2)의 원형 평균. 관측과 같은 규약(바람이 불어오는 방향). */
  readonly windDirection: number | null;
  /** 풍속 m/s. 범위 예보(S1~S2)의 대표값. */
  readonly windSpeed: number | null;
  /** 기온 ℃ — 해상예보에는 없다. 항상 null. */
  readonly airTemp: number | null;
  /** 강수량 mm — 해상예보에는 없다(PREP 은 유무 코드). 항상 null. */
  readonly precipitation: number | null;
  /** 하늘 상태 코드 (DB01 맑음 / DB02 구름조금 / DB03 구름많음 / DB04 흐림). 원문 코드 그대로. */
  readonly skyCode: string | null;
}

/** 위험도 산출이 실제로 쓰는 항목이 하나라도 있는가(파고·풍향·풍속). */
export function hasRiskSignal(reading: ForecastReading): boolean {
  return reading.waveHeight !== null || reading.windDirection !== null || reading.windSpeed !== null;
}
