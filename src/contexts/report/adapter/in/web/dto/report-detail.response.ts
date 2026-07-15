import { ApiProperty } from '@nestjs/swagger';
import { ReportListItemResponse } from './report-list-item.response';

/**
 * ADM-008 GET /admin/reports/{reportId} 응답 (ReportDetail 미러링).
 * 목록 필드 전부 + 검수에 필요한 시각/중복 정보.
 */
export class ReportDetailResponse extends ReportListItemResponse {
  @ApiProperty({
    example: '2026-07-13T23:20:00.000Z',
    description: '사용자가 실제로 목격했다고 고른 시각(제보 접수 시각과 다르다).',
  })
  occurredAt!: string;

  @ApiProperty({
    example: null,
    description: '위험도 산출에 반영된 시각. 검수 확인완료 후 재산출이 성공하면 채워진다.',
    nullable: true,
  })
  reflectedAt!: string | null;

  @ApiProperty({
    example: null,
    description: 'REPORT-004 중복 후보로 연결된 제보 id (동일 해변·시간대의 유사 제보).',
    nullable: true,
  })
  duplicateOfReportId!: number | null;
}
