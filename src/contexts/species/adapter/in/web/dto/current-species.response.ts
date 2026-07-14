import { ApiProperty } from '@nestjs/swagger';
import { ALERT_LEVELS, DENSITY_LEVELS } from '@contexts/observation/domain/observation-enums';
import { JellyfishSpeciesResponse } from './jellyfish-species.response';

/**
 * "지금 출현 중인 종" 응답 (CurrentSpeciesView 미러).
 * 예시값은 2026-07-09 국립수산과학원 주간보고 실데이터(제주시 노무라입깃해파리 고밀도)다.
 */
export class CurrentSpeciesResponse {
  @ApiProperty({
    example: '노무라입깃해파리',
    description:
      '출현 기록에 저장된 **원문 종명**. 국립수산과학원 발표 표기 그대로다(예: "유령해파리류"). ' +
      '화면에는 이 이름을 쓴다 — 기관 발표와 표기가 어긋나면 사용자가 대조할 수 없다.',
  })
  reportedName!: string;

  @ApiProperty({
    example: '제주시',
    nullable: true,
    description: '출현 시군구. 주간보고는 지점 좌표 없이 시군구 단위로만 발표한다.',
  })
  region!: string | null;

  @ApiProperty({
    enum: DENSITY_LEVELS,
    example: 'high',
    nullable: true,
    description: '출현 밀도. high(고밀도) / medium / low(저밀도).',
  })
  densityLevel!: string | null;

  @ApiProperty({
    enum: ALERT_LEVELS,
    example: 'caution',
    nullable: true,
    description: '기관 특보 단계에서 환산한 경보 수준. none / attention / caution / warning.',
  })
  alertLevel!: string | null;

  @ApiProperty({
    example: true,
    nullable: true,
    description: '출현 기록상 독성 종 여부. 미상이면 null. 상세 등급은 `species.toxicity` 를 본다.',
  })
  isToxic!: boolean | null;

  @ApiProperty({
    example: '2026-07-08T15:00:00.000Z',
    description: '가장 최근 출현 시점(UTC). 주간보고는 조사 종료일이 들어간다 — "언제 기준" 인지 화면에 표시할 것.',
  })
  occurredAt!: Date;

  @ApiProperty({
    type: JellyfishSpeciesResponse,
    nullable: true,
    description:
      '매칭된 도감 정보(사진·학명·특징·독성 등급). **도감에 없는 종이면 null** 이며, 그래도 위 출현 정보는 유효하다. ' +
      '이름 매칭은 표기 차이를 흡수한다 — 주간보고 "유령해파리류" 는 도감 "유령해파리" 에 붙는다.',
  })
  species!: JellyfishSpeciesResponse | null;
}
