import { ApiProperty } from '@nestjs/swagger';

/** G-006 안내/고지 문구 응답 (StaticGuideView 미러). */
export class StaticGuideResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'RESP_NOTICE' }) guideCode!: string;
  @ApiProperty({ example: 'public' }) targetType!: string;
  @ApiProperty({ example: 'danger', nullable: true }) riskLevel!: string | null;
  @ApiProperty({ example: '입수 주의 안내', nullable: true }) title!: string | null;
  @ApiProperty({ example: '현재 위험 단계에서는 입수를 자제해 주세요.' }) body!: string;
  @ApiProperty({ example: 1 }) displayOrder!: number;
}
