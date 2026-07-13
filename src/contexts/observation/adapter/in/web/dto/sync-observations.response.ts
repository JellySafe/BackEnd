import { ApiProperty } from '@nestjs/swagger';

/** POST /system/observations/sync 응답. 수집(SYS-001) + 매핑(SYS-002) 결과를 합친다. */
export class SyncObservationsResponse {
  @ApiProperty({ example: 4, description: '처리한 활성 데이터 소스 수' })
  sources!: number;

  @ApiProperty({ example: 3, description: '수집에 성공한 소스 수' })
  succeeded!: number;

  @ApiProperty({ example: 1, description: '수집에 실패한 소스 수(실패해도 배치는 계속된다)' })
  failed!: number;

  @ApiProperty({ example: 42, description: '새로 저장된 관측치 수(수온/파고/풍향 등)' })
  observationsInserted!: number;

  @ApiProperty({ example: 3, description: '새로 저장된 해파리 출현 기록 수' })
  occurrencesInserted!: number;

  @ApiProperty({ example: 12, description: '매핑을 갱신한 활성 해변 수' })
  beaches!: number;

  @ApiProperty({ example: 24, description: '저장/갱신된 관측소-해변 매핑 수' })
  mappings!: number;

  @ApiProperty({
    example: 0,
    description: '후보 관측소가 없어 매핑하지 못한 (해변, 관측유형) 조합 수',
  })
  unmapped!: number;
}
