import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';
import { RiskLevel } from '@shared/kernel/risk-level';

/**
 * report_date(DATE) 정규화 — 시각을 UTC 자정 0시로 맞춘다.
 * DB 는 DATE 타입이라 시각 성분이 없다. 조회/저장 키가 흔들리지 않도록 통일한다.
 */
export function normalizeReportDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** 집계 하루의 시각 윈도우 [start, end). 제보/대응/위험도 조회에 사용. */
export function dayWindow(reportDate: Date): { start: Date; end: Date } {
  const start = normalizeReportDate(reportDate);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

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
  summaryJson: unknown | null;
  maxRiskLevel: RiskLevel | null;
  riskChangeSummary: string | null;
  reportCount: number;
  toxicCount: number;
  stingCount: number;
  actionCount: number;
  memo: string | null;
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
      createdBy,
    });
  }

  /** DB row 복원. 불변식 검증 없이 재구성. */
  static reconstitute(props: DailyReportProps): DailyReport {
    return new DailyReport(props);
  }

  /** FLOW-ADM-004 운영자 메모 저장/수정. */
  updateMemo(memo: string | null): void {
    const trimmed = memo?.trim() ?? '';
    this.props.memo = trimmed.length > 0 ? trimmed : null;
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
      reportDate: reportDate.toISOString().slice(0, 10),
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

  /** 영속화/응답용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<DailyReportProps> {
    return { ...this.props };
  }
}
