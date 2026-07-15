import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { REJECT_REASONS, RejectReason, REVIEW_STATUSES, ReviewStatus } from '../../../../domain/report-enums';

/**
 * ADM-009 PATCH /admin/reports/:id/review 요청.
 * 반려(rejected) 시 rejectReason 필수 여부는 유스케이스/도메인에서 강제한다(REPORT-003).
 */
export class ReviewReportRequest {
  @ApiProperty({
    enum: REVIEW_STATUSES,
    example: 'verified',
    description:
      '검수 결과. verified(승인 — 위험도 산출에 반영된다) / rejected(반려) / hold(보류 — 판단을 미룸). 검수 화면의 승인·반려·보류 버튼에 대응한다.',
  })
  @IsIn(REVIEW_STATUSES as readonly string[])
  reviewStatus!: ReviewStatus;

  @ApiPropertyOptional({
    enum: REJECT_REASONS,
    example: 'not_jellyfish',
    description:
      '반려 사유. not_jellyfish(해파리가 아님) / unclear(사진이 불명확) / duplicate(중복 제보) / wrong_location(위치 오류) / inappropriate(부적절한 사진). reviewStatus 가 rejected 면 반드시 함께 보내야 한다(안 보내면 거부된다).',
  })
  @IsOptional()
  @IsIn(REJECT_REASONS as readonly string[])
  rejectReason?: RejectReason;

  @ApiPropertyOptional({
    example: '사진 속 개체는 해파리가 아닌 비닐로 판단됨.',
    maxLength: 500,
    description: '검수자 메모. 판단 근거를 남긴다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}
