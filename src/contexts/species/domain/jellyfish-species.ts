import { Id } from '@shared/kernel/id';
import { ToxicityLevel } from './species-enums';

/**
 * 해파리 종 정보 (jellyfish_species). 읽기 전용 참조 데이터라 애그리거트가 아닌 값 타입으로 둔다.
 * (static_guides / risk_recommendations 와 같은 취급)
 *
 * features / appearanceSeason / stingSymptom 은 **원문이 있는 종만** 채워진다.
 * 14종 중 6종만 국립수산과학원 응급처치 자료에 서술이 있고, 나머지는 null 이다.
 * null 을 그럴듯한 문장으로 메우지 마라 — 해파리 식별은 틀리면 사람이 다친다.
 */
export interface JellyfishSpeciesView {
  id: Id;
  /** 국명. 출현 기록(jellyfish_occurrences.species)과 매칭하는 키의 원본. */
  koreanName: string;
  scientificName: string | null;
  /** strong/mild/harmless. 기관 미발표 종은 null. */
  toxicity: ToxicityLevel | null;
  features: string | null;
  appearanceSeason: string | null;
  /** 쏘였을 때의 '증상'. 처치법이 아니다(응급처치는 static_guides.FIRST_AID 하나뿐). */
  stingSymptom: string | null;
  imageUrl: string | null;
  /** 이미지 출처. imageUrl 이 있으면 반드시 함께 내려보내고 화면에 표시한다. */
  imageSource: string | null;
  imageSourceUrl: string | null;
  displayOrder: number;
}

/**
 * "지금 출현 중인 종" — 최근 출현 기록(jellyfish_occurrences) + 매칭된 도감 정보.
 *
 * reportedName 은 **출현 기록에 저장된 원문 표기**다(예: '유령해파리류').
 * species 는 이름 정규화로 찾아낸 도감 항목이며, 도감에 없는 종이면 null 이다.
 * 매칭에 실패해도 출현 사실 자체는 버리지 않는다 — 이름·독성 여부·밀도는 그대로 내려간다.
 */
export interface CurrentSpeciesView {
  /** 출현 기록 원문 종명. 화면에는 이 이름을 쓴다(기관 발표와 어긋나면 안 되므로). */
  reportedName: string;
  /** 출현 시군구 (예: 제주시). NIFS 주간보고는 지점 좌표 없이 시군구 단위로만 발표한다. */
  region: string | null;
  /** 출현 밀도: low/medium/high. 미상이면 null. */
  densityLevel: string | null;
  /** 기관 발표 특보 단계: none/attention/caution/warning. */
  alertLevel: string | null;
  /** 출현 기록상 독성 종 여부(주간보고 파서가 채운다). 도감 등급과 별개 필드다. */
  isToxic: boolean | null;
  /** 가장 최근 출현 시점(UTC). 주간보고는 조사 종료일이 들어간다. */
  occurredAt: Date;
  /** 매칭된 도감 정보. 도감에 없는 종이면 null. */
  species: JellyfishSpeciesView | null;
}
