import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { RiskLevel } from '@shared/kernel/risk-level';
import { kstDayWindow, toKstDateKey, toKstDateString } from '@shared/kernel/kst-date';

/**
 * report_date(DATE) 정규화 — **KST 달력 날짜 키**(그 날짜의 UTC 자정)로 맞춘다.
 *
 * daily_reports.report_date 는 MySQL DATE 이고, Prisma 는 JS Date 의 **UTC 연/월/일만** 취한다.
 * 따라서 키는 UTC 자정이어야 한다(실측 근거는 @shared/kernel/kst-date 참고).
 * 단 그 연/월/일은 **KST 기준 달력 날짜**여야 한다 — 임의 시각을 넣어도 KST 날짜로 접힌다.
 * 날짜 키를 다시 넣어도 같은 키가 나온다(멱등).
 */
export function normalizeReportDate(date: Date): Date {
  return toKstDateKey(date);
}

/**
 * 집계 하루의 시각 윈도우 [start, end) — **KST 하루**(00:00~24:00)를 UTC 인스턴트로.
 * 제보(submitted_at)/대응(created_at)/위험도(generated_at) 는 모두 UTC DATETIME 이므로
 * 이 윈도우로 비교해야 운영자가 보는 하루와 집계 구간이 일치한다.
 *
 * 예) 2026-07-13 → [2026-07-12T15:00:00Z, 2026-07-13T15:00:00Z)
 *     = KST 07-13 00:00 ~ 07-14 00:00
 */
export function dayWindow(reportDate: Date): { start: Date; end: Date } {
  return kstDayWindow(reportDate);
}

/** 리포트 날짜 라벨(YYYY-MM-DD, KST 기준). */
export function reportDateLabel(reportDate: Date): string {
  return toKstDateString(reportDate);
}

/** 공개 코멘트 최대 길이. DB 컬럼 VARCHAR(300) 과 맞춘다(prisma/sql/005-...sql). */
export const PUBLIC_COMMENT_MAX_LENGTH = 300;

/** SYS-006 집계 결과 (Kysely 쿼리 어댑터가 산출). */
export interface DailyReportAggregation {
  /** 그날 발생한 위험도 산출 중 최고 단계. */
  maxRiskLevel: RiskLevel | null;
  /** now 지평 기준 그날 최초/최종 위험 단계 (변화 요약용). */
  firstRiskLevel: RiskLevel | null;
  lastRiskLevel: RiskLevel | null;
  /** 그날 생성된 위험도 산출 행 수(변동 횟수 근사). */
  riskChangeCount: number;
  reportCount: number;
  toxicCount: number;
  stingCount: number;
  actionCount: number;
}

export interface DailyReportProps {
  id?: Id;
  beachId: Id;
  reportDate: Date;
  summaryJson: unknown;
  maxRiskLevel: RiskLevel | null;
  riskChangeSummary: string | null;
  reportCount: number;
  toxicCount: number;
  stingCount: number;
  actionCount: number;
  memo: string | null;
  /**
   * 공개용 운영기관 코멘트 (이슈 #56). **memo 와 일부러 나눠 둔 값이다.**
   *
   * memo 는 운영자가 내부용으로 적은 글이라 담당자 이름·확인 요청 같은 것이 섞여 있을 수
   * 있다. 그걸 공개 경로에 그대로 붙이면 **공개를 전제하지 않고 쓴 글이 소급해서 전부**
   * **공개된다.** 되돌릴 수 없는 종류의 실수다. 그래서 공개는 명시적으로 고르게 한다.
   */
  publicComment: string | null;
  createdBy: Id | null;
}

/**
 * 일간 운영 리포트 애그리거트 (ADM-011 / SYS-006).
 * 특정 해변의 하루치 위험도 변화·제보·대응 집계를 담는다.
 * 프레임워크/ORM 비의존 순수 도메인.
 */
export class DailyReport {
  private constructor(private props: DailyReportProps) {}

  /**
   * SYS-006 집계 결과로부터 리포트를 구성한다(신규/재생성 공용).
   * report_count/toxic_count 등 수치와 요약(summary_json)을 채운다.
   */
  static fromAggregation(
    beachId: Id,
    reportDate: Date,
    agg: DailyReportAggregation,
    createdBy: Id | null,
    now: Date,
  ): DailyReport {
    if (!beachId || beachId <= 0) {
      throw new ValidationError('DAILY_REPORT_BEACH_REQUIRED', '해변 식별자가 필요합니다.');
    }
    const date = normalizeReportDate(reportDate);
    return new DailyReport({
      beachId,
      reportDate: date,
      summaryJson: DailyReport.buildSummaryJson(date, agg, now),
      maxRiskLevel: agg.maxRiskLevel,
      riskChangeSummary: DailyReport.buildRiskChangeSummary(agg),
      reportCount: agg.reportCount,
      toxicCount: agg.toxicCount,
      stingCount: agg.stingCount,
      actionCount: agg.actionCount,
      memo: null,
      publicComment: null,
      createdBy,
    });
  }

  /** DB row 복원. 불변식 검증 없이 재구성. */
  static reconstitute(props: DailyReportProps): DailyReport {
    return new DailyReport(props);
  }

  /** FLOW-ADM-004 운영자 메모 저장/수정. **내부용** — 공개되지 않는다. */
  updateMemo(memo: string | null): void {
    const trimmed = memo?.trim() ?? '';
    this.props.memo = trimmed.length > 0 ? trimmed : null;
  }

  /**
   * 공개용 운영기관 코멘트 저장/수정 (이슈 #56). 시민 화면(`GET /public/daily-report`)에 그대로 나간다.
   *
   * null 이나 빈 문자열을 주면 **공개를 내린다.** 잘못 올린 글을 지우는 것은 즉시 되어야 하므로
   * 별도 삭제 API 를 두지 않고 같은 경로로 처리한다.
   *
   * 길이는 DB 컬럼(VARCHAR(300))에 맞춰 자른다. 넘겨서 DB 오류로 실패시키면 운영자는 무엇이
   * 문제인지 알 수 없고, 그렇다고 통과시키면 저장 자체가 깨진다.
   */
  updatePublicComment(comment: string | null): void {
    const trimmed = comment?.trim() ?? '';
    this.props.publicComment = trimmed.length > 0 ? trimmed.slice(0, PUBLIC_COMMENT_MAX_LENGTH) : null;
  }

  /** 재생성 시 기존 리포트에 집계값을 다시 반영한다(메모는 보존). */
  applyAggregation(agg: DailyReportAggregation, now: Date): void {
    this.props.summaryJson = DailyReport.buildSummaryJson(this.props.reportDate, agg, now);
    this.props.maxRiskLevel = agg.maxRiskLevel;
    this.props.riskChangeSummary = DailyReport.buildRiskChangeSummary(agg);
    this.props.reportCount = agg.reportCount;
    this.props.toxicCount = agg.toxicCount;
    this.props.stingCount = agg.stingCount;
    this.props.actionCount = agg.actionCount;
  }

  private static buildRiskChangeSummary(agg: DailyReportAggregation): string | null {
    if (!agg.firstRiskLevel && !agg.lastRiskLevel) return null;
    if (agg.firstRiskLevel && agg.lastRiskLevel && agg.firstRiskLevel !== agg.lastRiskLevel) {
      return `${agg.firstRiskLevel} → ${agg.lastRiskLevel}`;
    }
    return `${agg.lastRiskLevel ?? agg.firstRiskLevel} 유지`;
  }

  private static buildSummaryJson(
    reportDate: Date,
    agg: DailyReportAggregation,
    now: Date,
  ): Record<string, unknown> {
    return {
      reportDate: reportDateLabel(reportDate),
      maxRiskLevel: agg.maxRiskLevel,
      firstRiskLevel: agg.firstRiskLevel,
      lastRiskLevel: agg.lastRiskLevel,
      riskChangeCount: agg.riskChangeCount,
      reportCount: agg.reportCount,
      toxicCount: agg.toxicCount,
      stingCount: agg.stingCount,
      actionCount: agg.actionCount,
      generatedAt: now.toISOString(),
    };
  }

  // --- 조회 ---

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id {
    return this.props.beachId;
  }
  get reportDate(): Date {
    return this.props.reportDate;
  }
  get memo(): string | null {
    return this.props.memo;
  }
  get publicComment(): string | null {
    return this.props.publicComment;
  }

  /** 영속화/응답용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<DailyReportProps> {
    return { ...this.props };
  }
}
