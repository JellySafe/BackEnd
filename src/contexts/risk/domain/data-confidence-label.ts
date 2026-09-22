import { DataConfidence } from '@shared/kernel/risk-level';
import { Locale, LocaleText, text } from '@shared/i18n/locale';

/**
 * 관측 자료 상태 라벨 (시민 화면용).
 *
 * ── ⚠️ 왜 '신뢰도' 라고 부르지 않나 ─────────────────────────────────────────────────
 * 값 자체는 `high | medium | low` 이고 API 필드 이름도 `dataConfidence` 다. 그런데 그것을
 * 시민에게 **"신뢰도 높음"** 으로 보여주면 *"이 예측을 믿어도 된다"* 로 읽힌다.
 *
 * 그건 우리가 **측정한 적 없는 주장**이다. 해변별 예측 정확도 표본은 현재 0건이고
 * (docs/backtest.md, #83), 전체 정확도조차 시군구 단위 정답으로 거칠게 잰 값이다.
 *
 * deriveConfidence 가 실제로 답하는 질문은 하나다 — **"이 판정을 뒷받침할 관측 자료가
 * 충분한가."** 입력이 완벽해도 룰이 틀렸으면 예측은 틀린다. 이 값은 그것을 보지 않는다.
 *
 * 이 서비스에서는 그 차이가 위험한 방향으로 어긋난다. `안전` + `신뢰도 높음` 을 본 사람은
 * 물에 들어간다. 그런데 그 "높음" 이 실제로 보장하는 것은 **10km 안의 부이에서 3시간 안에
 * 값이 다 들어왔다** 는 것뿐이다.
 *
 * 그래서 라벨은 **자료 이야기만** 한다. 판단은 위험 단계가 한다.
 */
const LABELS: Record<DataConfidence, LocaleText> = {
  high: {
    ko: '관측 자료 충분',
    en: 'Full observation data',
    zh: '观测数据充足',
    ja: '観測データ十分',
  },
  medium: {
    ko: '관측 자료 일부 없음',
    en: 'Some observation data missing',
    zh: '部分观测数据缺失',
    ja: '観測データ一部なし',
  },
  low: {
    // '부족' 이라고만 하면 "조금 모자라다" 로 읽힌다. low 는 수온을 한 값도 못 받았거나
    // 관측이 하루 넘게 끊긴 상태라, 판정의 근거가 거의 없다는 뜻이다.
    ko: '관측 자료 많이 부족',
    en: 'Observation data largely unavailable',
    zh: '观测数据严重不足',
    ja: '観測データ大幅に不足',
  },
};

/** 시민에게 보여줄 관측 자료 상태 문구. */
export function dataConfidenceLabelOf(confidence: DataConfidence, locale: Locale): string {
  return text(LABELS[confidence], locale);
}
