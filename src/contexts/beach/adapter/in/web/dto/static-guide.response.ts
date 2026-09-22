import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_LOCALES } from '@shared/i18n/locale';

/** G-006 안내/고지 문구 응답 (StaticGuideView 미러). */
export class StaticGuideResponse {
  @ApiProperty({ example: 1 }) id!: number;
  @ApiProperty({ example: 'RESP_NOTICE' }) guideCode!: string;
  @ApiProperty({ example: 'public' }) targetType!: string;
  @ApiProperty({ example: 'danger', nullable: true }) riskLevel!: string | null;
  @ApiProperty({ example: '입수 주의 안내', nullable: true }) title!: string | null;
  @ApiProperty({ example: '현재 위험 단계에서는 입수를 자제해 주세요.' }) body!: string;

  @ApiProperty({
    example: 'ko',
    enum: SUPPORTED_LOCALES as readonly string[],
    description: [
      '**실제로 내보낸 언어.** 요청 언어와 다를 수 있다.',
      '',
      '⚠️ 번역이 없거나 **원문이 바뀐 뒤의 낡은 번역**이면 `ko` 로 떨어진다 —',
      '응급대처법 지침이 갱신됐는데 옛 번역을 내보내면 현행과 반대되는 처치를 안내하게 된다.',
      '화면에서 "원문(한국어)" 임을 표시할지 판단하는 데 쓴다.',
    ].join(' '),
  })
  locale!: string;

  @ApiProperty({ example: 1 }) displayOrder!: number;
}
