import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REJECT_REASONS, RejectReason, REVIEW_STATUSES, ReviewStatus } from '../../../../domain/report-enums';

/**
 * ADM-009 PATCH /admin/reports/:id/review 요청.
 * 반려(rejected) 시 rejectReason 필수 여부는 유스케이스/도메인에서 강제한다(REPORT-003).
 */
export class ReviewReportRequest {
  @IsIn(REVIEW_STATUSES as readonly string[])
  reviewStatus!: ReviewStatus;

  @IsOptional()
  @IsIn(REJECT_REASONS as readonly string[])
  rejectReason?: RejectReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}
