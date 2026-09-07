import { Id } from '@shared/kernel/id';
import {
  NO_DATA_LABEL_I18N,
  RISK_LEVELS,
  RiskLevel,
  compareRiskLevel,
  maxRiskLevel,
  riskLevelLabelOf,
} from '@shared/kernel/risk-level';
import { DEFAULT_LOCALE, Locale, text } from '@shared/i18n/locale';
import { reportDateLabel } from './daily-report';

/**
 * 공개용 일간 리포트 (이슈 #56) — **제주 전체를 한 장으로.**
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 공개 앱에는 "오늘 제주 해파리 상황" 을 한눈에 보는 화면이 없다. 지금 있는 공개 API 로는
 * 해변 12곳을 하나씩 열어야 전체 그림이 잡힌다(`public/beaches/:id/risk` ×12).
 *
 * ── 왜 admin/daily-reports 를 그냥 열지 않았나 ───────────────────────────────────────
 * 두 가지가 안 맞는다.
 *
 *  1) **집계 단위가 다르다.** 관리자 리포트는 해변 하나의 하루다. 시민이 알고 싶은 것은
 *     "제주 전체가 오늘 어떤가" 이므로, 해변별 리포트를 그대로 노출해서는 답이 되지 않는다.
 *
 *  2) **공개하면 안 되는 값이 섞여 있다.** `memo` 는 운영자가 내부용으로 쓴 글이다. 담당자
 *     이름·확인 요청 같은 것이 들어 있을 수 있고, 무엇보다 **공개를 전제하지 않고 쓰였다.**
 *     그 컬럼을 공개 경로에 붙이면 과거에 쓰인 글까지 소급해서 전부 공개된다.
 *     그래서 공개용 코멘트(`publicComment`)를 따로 두고, 운영자가 고른 것만 내보낸다.
 *
 * ── 왜 daily_reports 행이 아니라 원본에서 다시 집계하나 ──────────────────────────────
 * `daily_reports` 는 스케줄러가 **전날** 것을 만든다. 그 행만 읽으면 "오늘" 을 물었을 때 늘
 * 비어 있다 — 정작 시민이 가장 많이 볼 날짜다. 그래서 위험도·제보 원본을 그날 윈도우로 다시
 * 집계한다. 저장 여부와 무관하게 오늘도 어제도 같은 방식으로 답할 수 있다.
 * `daily_reports` 에서 가져오는 것은 운영자가 직접 쓴 **공개 코멘트 하나뿐**이다.
 */

/** 위험 단계가 하나도 산출되지 않은 해변을 세는 칸. */
export const UNKNOWN_LEVEL = 'unknown' as const;

/** 산출 이력이 없을 때 쓰는 표시 문구(한국어). 언어별 값은 커널의 NO_DATA_LABEL_I18N. */
export const NO_DATA_LABEL = NO_DATA_LABEL_I18N.ko;

/** 해변 하나의 그날치 사실. 어댑터가 원본에서 모아 온다. */
export interface BeachDayFacts {
  beachId: Id;
  name: string;
  region: string;
  /** 그날 처음 산출된 단계(now 지평). 이력이 없으면 null. */
  firstRiskLevel: RiskLevel | null;
  /** 그날 마지막으로 산출된 단계. 이력이 없으면 null. */
  lastRiskLevel: RiskLevel | null;
  /** 그날 최고 단계. 이력이 없으면 null. */
  maxRiskLevel: RiskLevel | null;
  reportCount: number;
  toxicCount: number;
  stingCount: number;
  /** 운영자가 **공개를 선택해** 쓴 코멘트. 내부 메모(memo)와 다른 값이다. */
  publicComment: string | null;
}

/** 등급이 오른 해변 하나. */
export interface RaisedBeach {
  beachId: Id;
  name: string;
  from: RiskLevel;
  to: RiskLevel;
  fromLabel: string;
  toLabel: string;
}

/** 독성 의심 제보가 있었던 해변 하나. */
export interface ToxicBeach {
  beachId: Id;
  name: string;
  toxicCount: number;
}

/** 운영기관 코멘트 하나. */
export interface PublicComment {
  beachId: Id;
  name: string;
  comment: string;
}

/** 등급별 해변 수. `unknown` 은 **산출 이력이 없는 해변**이다. */
export type LevelCounts = Record<RiskLevel | typeof UNKNOWN_LEVEL, number>;

export interface PublicDailyReport {
  /** 기준 일자(YYYY-MM-DD, KST). */
  reportDate: string;
  /** 이 응답을 만든 시각(UTC ISO). 캐시된 값인지 판단하는 근거가 된다. */
  generatedAt: string;
  /** 제주 전체 최고 등급. 산출 이력이 하나도 없으면 null. */
  maxRiskLevel: RiskLevel | null;
  /** 최고 등급 표시 라벨. 이력이 없으면 '정보 없음'. */
  maxRiskLabel: string;
  /** 집계 대상 해변 수(운영 중인 해변). */
  beachCount: number;
  levelCounts: LevelCounts;
  raisedBeaches: RaisedBeach[];
  toxicBeaches: ToxicBeach[];
  comments: PublicComment[];
  totals: { reportCount: number; toxicCount: number; stingCount: number };
}

/**
 * 해변별 사실들을 제주 전체 하루 요약으로 접는다.
 *
 * ── 등급별 해변 수를 "그날 최고 단계" 로 세는 이유 ───────────────────────────────────
 * 마지막 단계로 세면 낮에 '위험' 이었다가 저녁에 내려간 해변이 '낮음' 칸에 들어간다. 하루를
 * 돌아보는 요약에서 **그날 위험했다는 사실이 사라지는 것**은 이 서비스가 해서는 안 되는
 * 종류의 반올림이다. 등급 변화는 `raisedBeaches` 가 따로 보여 준다.
 *
 * ── 산출 이력이 없는 해변을 'safe' 로 세지 않는 이유 ─────────────────────────────────
 * "모른다" 를 "안전하다" 로 채우는 것이 이 서비스에서 가장 나쁜 응답이다. 관측이 끊겨 아무
 * 값도 못 낸 해변이 '낮음' 칸에 쌓이면, 화면은 실제보다 안전해 보인다. 그래서 `unknown` 칸을
 * 따로 두고 숫자로 드러낸다(shared/kernel/risk-level.ts 의 라벨 결정과 같은 기준이다).
 */
export function summarizePublicDailyReport(
  reportDate: Date,
  facts: BeachDayFacts[],
  now: Date,
  locale: Locale = DEFAULT_LOCALE,
): PublicDailyReport {
  const levelCounts = emptyLevelCounts();
  let overallMax: RiskLevel | null = null;
  const totals = { reportCount: 0, toxicCount: 0, stingCount: 0 };
  const raisedBeaches: RaisedBeach[] = [];
  const toxicBeaches: ToxicBeach[] = [];
  const comments: PublicComment[] = [];

  for (const fact of facts) {
    if (fact.maxRiskLevel === null) {
      levelCounts[UNKNOWN_LEVEL] += 1;
    } else {
      levelCounts[fact.maxRiskLevel] += 1;
      overallMax = overallMax === null ? fact.maxRiskLevel : maxRiskLevel(overallMax, fact.maxRiskLevel);
    }

    totals.reportCount += fact.reportCount;
    totals.toxicCount += fact.toxicCount;
    totals.stingCount += fact.stingCount;

    if (
      fact.firstRiskLevel !== null &&
      fact.lastRiskLevel !== null &&
      compareRiskLevel(fact.lastRiskLevel, fact.firstRiskLevel) > 0
    ) {
      raisedBeaches.push({
        beachId: fact.beachId,
        name: fact.name,
        from: fact.firstRiskLevel,
        to: fact.lastRiskLevel,
        fromLabel: riskLevelLabelOf(fact.firstRiskLevel, locale),
        toLabel: riskLevelLabelOf(fact.lastRiskLevel, locale),
      });
    }

    if (fact.toxicCount > 0) {
      toxicBeaches.push({ beachId: fact.beachId, name: fact.name, toxicCount: fact.toxicCount });
    }

    if (fact.publicComment !== null && fact.publicComment.trim().length > 0) {
      comments.push({
        beachId: fact.beachId,
        name: fact.name,
        comment: fact.publicComment.trim(),
      });
    }
  }

  // 특기 사항은 심각한 것부터 보여 준다 — 목록이 길어지면 아래쪽은 읽히지 않는다.
  raisedBeaches.sort((a, b) => compareRiskLevel(b.to, a.to) || a.name.localeCompare(b.name));
  toxicBeaches.sort((a, b) => b.toxicCount - a.toxicCount || a.name.localeCompare(b.name));

  return {
    reportDate: reportDateLabel(reportDate),
    generatedAt: now.toISOString(),
    maxRiskLevel: overallMax,
    maxRiskLabel:
      overallMax === null ? text(NO_DATA_LABEL_I18N, locale) : riskLevelLabelOf(overallMax, locale),
    beachCount: facts.length,
    levelCounts,
    raisedBeaches,
    toxicBeaches,
    comments,
    totals,
  };
}

function emptyLevelCounts(): LevelCounts {
  // 0 인 칸도 반드시 넣는다. 키가 빠지면 화면이 "그 등급이 없다" 와 "값을 못 받았다" 를
  // 구분하지 못하고, 프론트마다 다르게 처리하게 된다.
  const counts = { [UNKNOWN_LEVEL]: 0 } as LevelCounts;
  for (const level of RISK_LEVELS) counts[level] = 0;
  return counts;
}
