import { ApiProperty } from '@nestjs/swagger';

/** SYS-001 GET /admin/data-sources 목록 한 행 (DataSourceStatusView 미러링). */
export class DataSourceStatusResponse {
  @ApiProperty({ example: 3, description: '데이터 소스 식별자' })
  id!: number;

  @ApiProperty({ example: 'KHOA_MARINE', description: '소스 코드' })
  sourceCode!: string;

  @ApiProperty({ example: '국립해양조사원 해양관측', description: '소스명' })
  name!: string;

  @ApiProperty({ example: 'KHOA', description: '제공 기관', nullable: true })
  provider!: string | null;

  @ApiProperty({
    example: 'marine',
    description: '데이터 소스 유형',
    enum: ['jellyfish', 'marine', 'weather', 'beach'],
  })
  sourceType!: string;

  @ApiProperty({ example: false, description: '샘플 데이터 여부' })
  isSample!: boolean;

  @ApiProperty({ example: true, description: '활성 여부' })
  isActive!: boolean;

  @ApiProperty({ example: 60, description: '수집 주기(분)', nullable: true })
  syncIntervalMinutes!: number | null;

  @ApiProperty({
    example: '2026-07-10T09:00:00.000Z',
    description: '마지막 수집 일시',
    nullable: true,
  })
  lastSyncedAt!: string | null;

  @ApiProperty({
    example: 'success',
    description: '마지막 수집 결과 상태',
    enum: ['success', 'partial', 'failed'],
    nullable: true,
  })
  lastSyncStatus!: string | null;

  @ApiProperty({ example: '12건 수집 완료', description: '마지막 수집 메시지', nullable: true })
  lastSyncMessage!: string | null;
}
