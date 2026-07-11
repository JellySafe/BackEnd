import { Id } from '@shared/kernel/id';
import { UnprocessableError, ValidationError } from '@shared/kernel/domain-error';
import { AiResult, RejectReason, ReportStatus, ReportType } from './report-enums';

export interface JellyfishReportProps {
  id?: Id;
  beachId: Id | null;
  reporterUserId: Id | null;
  reporterToken: string | null;
  lat: number | null;
  lng: number | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  reportType: ReportType;
  status: ReportStatus;
  aiResult: AiResult | null;
  aiConfidence: number | null;
  duplicateOfReportId: Id | null;
  occurredAt: Date;
  submittedAt: Date;
  reflectedAt: Date | null;
  purgeScheduledAt: Date | null;
}

export interface NewReportInput {
  beachId: Id | null;
  reporterUserId: Id | null;
  reporterToken: string | null;
  lat: number | null;
  lng: number | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  reportType: ReportType;
  occurredAt: Date;
}

/** REPORT-002 허용 상태 전이 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  received: ['ai_processing'],
  ai_processing: ['ai_done'],
  ai_done: ['verified', 'rejected', 'hold'],
  hold: ['verified', 'rejected'],
  verified: ['reflected'],
  rejected: [],
  reflected: [],
};

/**
 * 사용자 해파리 제보 애그리거트.
 * 상태 전이(REPORT-002)와 입력 불변식(REPORT-001)을 캡슐화한다.
 * 프레임워크/ORM 에 의존하지 않는 순수 도메인 객체다.
 */
export class JellyfishReport {
  private constructor(private props: JellyfishReportProps) {}

  // --- 팩토리 ---

  /** 신규 제보 접수 (USR-004). status=received 로 시작. */
  static create(input: NewReportInput, now: Date): JellyfishReport {
    if (!input.imageUrl?.trim()) {
      throw new ValidationError('REPORT_IMAGE_REQUIRED', '제보 사진이 필요합니다.');
    }
    const hasBeach = input.beachId !== null && input.beachId !== undefined;
    const hasGps = input.lat !== null && input.lng !== null;
    if (!hasBeach && !hasGps) {
      throw new ValidationError('REPORT_LOCATION_REQUIRED', '해변 선택 또는 GPS 좌표가 필요합니다.');
    }
    if (input.reporterUserId === null && !input.reporterToken?.trim()) {
      throw new ValidationError('REPORT_REPORTER_REQUIRED', '제보자 식별 정보가 필요합니다.');
    }
    if (input.occurredAt.getTime() > now.getTime()) {
      throw new ValidationError('REPORT_OCCURRED_FUTURE', '발견 시각이 미래일 수 없습니다.');
    }

    return new JellyfishReport({
      beachId: input.beachId,
      reporterUserId: input.reporterUserId,
      reporterToken: input.reporterToken,
      lat: input.lat,
      lng: input.lng,
      imageUrl: input.imageUrl,
      thumbnailUrl: input.thumbnailUrl ?? null,
      reportType: input.reportType,
      status: 'received',
      aiResult: null,
      aiConfidence: null,
      duplicateOfReportId: null,
      occurredAt: input.occurredAt,
      submittedAt: now,
      reflectedAt: null,
      purgeScheduledAt: null,
    });
  }

  /** DB 등 영속 저장소에서 복원. 불변식 검증 없이 그대로 재구성한다. */
  static reconstitute(props: JellyfishReportProps): JellyfishReport {
    return new JellyfishReport(props);
  }

  // --- 상태 전이 ---

  /** AI 판별 시작 (SYS-004). received → ai_processing */
  startAiProcessing(): void {
    this.transitionTo('ai_processing');
  }

  /**
   * AI 판별 완료. ai_processing → ai_done.
   * AI-003: 판별 실패/저품질은 result=unknown 으로 둔다('실패' 상태를 따로 두지 않음).
   */
  completeAi(result: AiResult, confidence: number | null): void {
    this.transitionTo('ai_done');
    this.props.aiResult = result;
    this.props.aiConfidence = confidence;
  }

  /** 검수: 확인완료 (ADM-009). ai_done/hold → verified */
  verify(): void {
    this.transitionTo('verified');
  }

  /** 검수: 반려 (ADM-009, REPORT-003). ai_done/hold → rejected. 사유 필수. */
  reject(reason: RejectReason, duplicateOfReportId: Id | null = null): void {
    if (!reason) {
      throw new ValidationError('REVIEW_REJECT_REASON_REQUIRED', '반려 사유가 필요합니다.');
    }
    this.transitionTo('rejected');
    if (reason === 'duplicate' && duplicateOfReportId !== null) {
      this.props.duplicateOfReportId = duplicateOfReportId;
    }
  }

  /** 검수: 보류 (ADM-009). ai_done → hold */
  hold(): void {
    this.transitionTo('hold');
  }

  /** 위험도 반영 완료 (FLOW-SYS-001). verified → reflected */
  markReflected(now: Date): void {
    this.transitionTo('reflected');
    this.props.reflectedAt = now;
  }

  /** 보관 만료 예정 시각 지정 (PRIV-003) */
  schedulePurge(at: Date): void {
    this.props.purgeScheduledAt = at;
  }

  private transitionTo(next: ReportStatus): void {
    const allowed = ALLOWED_TRANSITIONS[this.props.status];
    if (!allowed.includes(next)) {
      throw new UnprocessableError(
        'REPORT_INVALID_TRANSITION',
        `제보 상태 전이가 허용되지 않습니다: ${this.props.status} → ${next}`,
        { from: this.props.status, to: next },
      );
    }
    this.props.status = next;
  }

  // --- 조회 ---

  get id(): Id | undefined {
    return this.props.id;
  }
  get beachId(): Id | null {
    return this.props.beachId;
  }
  get status(): ReportStatus {
    return this.props.status;
  }
  get reportType(): ReportType {
    return this.props.reportType;
  }
  get aiResult(): AiResult | null {
    return this.props.aiResult;
  }
  get aiConfidence(): number | null {
    return this.props.aiConfidence;
  }
  get isToxicSuspected(): boolean {
    return this.props.aiResult === 'toxic_suspected';
  }
  get isSting(): boolean {
    return this.props.reportType === 'sting';
  }

  /** 영속화용 스냅샷 (어댑터 전용). */
  snapshot(): Readonly<JellyfishReportProps> {
    return { ...this.props };
  }
}
