import { ApiProperty } from '@nestjs/swagger';

/** 해변이 보고 있는 관측소 한 곳. */
export class BeachStationLinkResponse {
  @ApiProperty({ example: 12 }) stationId!: number;
  @ApiProperty({ example: '제주(해양)' }) stationName!: string;

  @ApiProperty({
    example: 'marine',
    enum: ['marine', 'weather'],
    description: 'marine(해양 — 수온·파고·해류) / weather(기상 — 기온·풍향·풍속)',
  })
  stationType!: string;

  @ApiProperty({
    example: 8.42,
    nullable: true,
    description: [
      '해변에서 관측소까지의 거리(km).',
      '**멀수록 그 값이 이 해변을 대표하지 못한다** — 40km 떨어진 관측소의 수온으로 나온',
      "'낮음' 은 화면만 봐서는 구분되지 않는다.",
    ].join(' '),
  })
  distanceKm!: number | null;

  @ApiProperty({
    example: true,
    description: '그 유형의 대표 관측소인가. 위험도 산출이 우선적으로 읽는 곳이다',
  })
  isPrimary!: boolean;

  @ApiProperty({
    example: '2026-09-12T03:00:00.000Z',
    nullable: true,
    description: '마지막 관측 시각. **null 이면 이 관측소에서 받은 값이 한 번도 없다**',
  })
  lastObservedAt!: string | null;

  @ApiProperty({
    example: 35,
    nullable: true,
    description: [
      '마지막 관측이 몇 분 전인가. 수집은 30분 주기이므로 60분을 넘으면 끊긴 것으로 본다.',
      'null 이면 관측이 아예 없다.',
    ].join(' '),
  })
  ageMinutes!: number | null;
}

/** 해변 하나의 관측 연결 상태. */
export class BeachMappingDiagnosticsResponse {
  @ApiProperty({ example: 3 }) beachId!: number;
  @ApiProperty({ example: '함덕해수욕장' }) beachName!: string;
  @ApiProperty({ example: '제주시' }) region!: string;

  @ApiProperty({
    type: [BeachStationLinkResponse],
    description: [
      '이 해변이 보고 있는 관측소들.',
      '',
      '⚠️ **빈 배열이면 매핑이 없다는 뜻이다** — 그 해변은 관측 기반 위험도를 낼 수 없고,',
      '공개 화면에서 `unknown` 으로 집계된다. 목록에서 빼지 않고 빈 채로 보여주는 이유가 그것이다',
      '(빼 버리면 정작 가장 문제인 해변이 보이지 않는다).',
    ].join('\n'),
  })
  stations!: BeachStationLinkResponse[];
}
