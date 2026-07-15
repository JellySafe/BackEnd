import { ApiProperty } from '@nestjs/swagger';

/** SYS-001 GET /admin/observations 목록 한 행 (ObservationView 미러링). */
export class ObservationResponse {
  @ApiProperty({ example: 88123, description: '관측치 식별자' })
  id!: number;

  @ApiProperty({ example: 21, description: '관측소 식별자' })
  stationId!: number;

  @ApiProperty({ example: '제주 해양관측소', description: '관측소명', nullable: true })
  stationName!: string | null;

  @ApiProperty({ example: '2026-07-10T09:00:00.000Z', description: '관측 일시' })
  observedAt!: string;

  @ApiProperty({ example: 24.3, description: '수온(℃)', nullable: true })
  waterTemp!: number | null;

  @ApiProperty({ example: 33.1, description: '염분(psu)', nullable: true })
  salinity!: number | null;

  @ApiProperty({ example: 0.8, description: '파고(m)', nullable: true })
  waveHeight!: number | null;

  @ApiProperty({ example: 180, description: '유향(deg)', nullable: true })
  currentDirection!: number | null;

  @ApiProperty({ example: 0.5, description: '유속(m/s)', nullable: true })
  currentSpeed!: number | null;

  @ApiProperty({ example: 270, description: '풍향(deg)', nullable: true })
  windDirection!: number | null;

  @ApiProperty({ example: 3.2, description: '풍속(m/s)', nullable: true })
  windSpeed!: number | null;

  @ApiProperty({ example: 26.5, description: '기온(℃)', nullable: true })
  airTemp!: number | null;

  @ApiProperty({ example: 0.0, description: '강수량(mm)', nullable: true })
  precipitation!: number | null;

  @ApiProperty({
    example: 'normal',
    description: '품질 플래그',
    enum: ['normal', 'missing', 'outlier'],
  })
  qualityFlag!: string;
}
