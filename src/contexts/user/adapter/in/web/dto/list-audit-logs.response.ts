import { ApiProperty } from '@nestjs/swagger';

/**
 * AUTH-002 GET /admin/audit-logs 목록 한 행 응답.
 * AuditLogListItem 미러링.
 */
export class AuditLogListItemResponse {
  @ApiProperty({ example: 100 }) auditLogId!: number;
  @ApiProperty({ example: 1, nullable: true, type: Number }) userId!: number | null;
  @ApiProperty({ example: 'REVIEW_REPORT' }) actionType!: string;
  @ApiProperty({ example: 'report' }) targetType!: string;
  @ApiProperty({ example: 42, nullable: true, type: Number }) targetId!: number | null;
  @ApiProperty({ example: '203.0.113.10', nullable: true, type: String }) ipAddress!: string | null;
  @ApiProperty({ example: '2026-07-13T03:55:37.483Z' }) createdAt!: string;
}
