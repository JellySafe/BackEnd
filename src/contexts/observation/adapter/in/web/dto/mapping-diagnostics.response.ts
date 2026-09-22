import { ApiProperty } from '@nestjs/swagger';
import {
  MEASUREMENT_CODES,
  MeasurementCode,
} from '../../../../domain/observation-measurements';

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

/** 관측 항목 한 가지의 수급 상태. */
export class MeasurementCoverageResponse {
  @ApiProperty({ enum: MEASUREMENT_CODES as readonly string[], example: 'current' })
  code!: MeasurementCode;

  @ApiProperty({ example: '유향·유속' }) label!: string;

  @ApiProperty({
    example: false,
    description: '최근 24시간 안에 이 값을 준 관측소가 하나라도 있었는가.',
  })
  available!: boolean;

  @ApiProperty({
    example: ['TW_0075'],
    description: '그 값을 준 관측소 코드. **빈 배열이면 아무도 주지 않는다.**',
  })
  providedBy!: string[];

  @ApiProperty({ example: '2026-09-22T04:01:08.000Z', nullable: true, type: String })
  lastValueAt!: Date | null;

  @ApiProperty({
    example: ['CURRENT_INFLOW'],
    description: [
      '이 항목이 없어서 **평가되지 못하는 위험 요인.**',
      '',
      '결측 요인 하나마다 신뢰도가 내려간다(셋 이상이면 `low`). 그래서 여기 값이 있으면',
      '그 해변의 신뢰도는 **구조적으로 `high` 에 도달하지 못한다** — 기다려서 해결되지 않는다.',
    ].join(' '),
  })
  blockedFactors!: string[];
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

  @ApiProperty({
    type: [MeasurementCoverageResponse],
    description: [
      '이 해변이 **실제로 받고 있는 관측 항목.**',
      '',
      '⚠️ 관측소가 붙어 있고 `ageMinutes` 가 정상이어도 **그 관측소가 특정 값을 아예 주지',
      '않을 수 있다.** 파고부이는 유향·유속을 관측하지 않는다 — 그래서 거기 붙은 해변은',
      '`CURRENT_INFLOW` 가 영원히 결측이고 신뢰도가 `medium` 에서 멈춘다.',
      '',
      '그 사실이 없으면 운영자는 "수집이 밀렸나 보다" 하고 기다리게 된다. **기다려도 오지',
      '않는다.** "지금 안 온다" 와 "여기서는 원래 안 온다" 는 해야 할 일이 완전히 다르다 —',
      '앞은 수집을 고치는 일이고, 뒤는 관측소를 늘리거나 포기하는 일이다.',
    ].join('\n'),
  })
  measurements!: MeasurementCoverageResponse[];
}
