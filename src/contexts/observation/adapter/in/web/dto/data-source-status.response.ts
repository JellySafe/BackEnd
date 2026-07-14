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

  // ---------------------------------------------------------------- 수집 건강 판정 (추가분)
  //
  // 기존 필드(lastSyncedAt/lastSyncStatus/…)는 "마지막 실행이 어땠나"만 알려 준다.
  // 정작 위험한 건 **성공으로 기록되는 고장**이다(NIFS 주간보고 PDF 양식이 바뀌면
  // 수집기가 조용히 0건을 반환하고 status 는 계속 success 로 남는다).
  // 아래 필드는 그 상태를 판정해 관리자 화면에 그대로 노출한다.

  @ApiProperty({
    example: 'ok',
    description: [
      '수집 건강 판정.',
      '- `ok`: 정상 수집 중',
      '- `degraded`: 수집은 성공하는데 결과가 계속 0건 — **사람이 원본을 확인해야 함**(고장으로 단정하지 않는다)',
      '- `unhealthy`: 수집 실패 중이거나 배치가 멈춤',
      '- `unknown`: 비활성 소스이거나 아직 한 번도 수집되지 않음',
    ].join('\n'),
    enum: ['ok', 'degraded', 'unhealthy', 'unknown'],
  })
  health!: string;

  @ApiProperty({
    example: 'none',
    description: [
      '판정 사유 코드.',
      '- `none`: 이상 없음',
      '- `inactive`: 비활성 소스',
      '- `never_synced`: 수집 이력 없음',
      '- `sync_failing`: 수집이 예외로 실패 중',
      '- `stale`: 수집 주기 대비 마지막 수집이 너무 오래됨(배치가 안 돎)',
      '- `zero_yield`: 수집은 성공하는데 수집기가 계속 빈손(파서/양식 변경 의심)',
    ].join('\n'),
    enum: ['none', 'inactive', 'never_synced', 'sync_failing', 'stale', 'zero_yield'],
  })
  healthReason!: string;

  @ApiProperty({
    example: '정상 수집 중.',
    description: '판정 근거를 사람이 읽을 수 있게 풀어 쓴 문구. 그대로 화면에 띄우면 된다.',
  })
  healthDetail!: string;

  @ApiProperty({
    example: 12,
    description: '마지막 수집 이후 경과(분). 한 번도 수집되지 않았으면 null',
    nullable: true,
  })
  minutesSinceLastSync!: number | null;

  @ApiProperty({
    example: 90,
    description:
      '이 시간(분)을 넘기면 stale 로 본다. `syncIntervalMinutes × OBSERVATION_SOURCE_STALE_MULTIPLIER`',
    nullable: true,
  })
  staleAfterMinutes!: number | null;

  @ApiProperty({
    example: 0,
    description:
      '수집기가 연속으로 0건을 반환한 횟수. 0 이면 정상. ' +
      '저장 건수가 아니라 **수집기가 내놓은 건수** 기준이다(중복 저장 스킵과 구분하기 위함).',
  })
  zeroYieldRuns!: number;

  @ApiProperty({
    example: null,
    description: '연속 0건이 시작된 시각. 지속 기간으로 zero_yield 를 판정한다',
    nullable: true,
  })
  zeroYieldSince!: string | null;

  @ApiProperty({ example: 0, description: '연속 수집 실패 횟수' })
  failureRuns!: number;
}
