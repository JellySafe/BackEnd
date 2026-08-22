import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DENSITY_LEVELS, DensityLevel } from '@contexts/observation/domain/observation-enums';
import { RISK_LEVELS, RiskLevel } from '@shared/kernel/risk-level';
import {
  EVALUATION_OUTCOMES,
  INCIDENT_SOURCES,
  IncidentSource,
  OBSERVATION_SOURCES,
  ObservationSource,
  STING_SEVERITIES,
  StingSeverity,
} from '../../../../domain/groundtruth-enums';

/**
 * groundtruth 요청/응답 DTO.
 *
 * 이 컨텍스트의 화면은 셋뿐이라(관측 입력·사고 입력·정확도 보기) DTO 를 한 파일에 모은다.
 */

// ── 현장 관측 ───────────────────────────────────────────────────────────────────────

export class RecordFieldObservationRequest {
  @ApiProperty({ example: 1, minimum: 1, description: '관측한 해변의 id.' })
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiProperty({
    example: '2026-08-20T09:00:00Z',
    description: '관측한 시각(ISO 8601). 신고 시각이 아니라 **실제로 본 시각**이다. 미래는 거부한다.',
  })
  @IsDateString()
  observedAt!: string;

  @ApiProperty({
    enum: OBSERVATION_SOURCES,
    example: 'lifeguard',
    description:
      '누가 관측했는가. lifeguard(안전요원 정기 관측) / official(지자체·운영기관 점검) / partner(협약 기관).',
  })
  @IsIn(OBSERVATION_SOURCES as readonly string[])
  source!: ObservationSource;

  @ApiProperty({
    example: false,
    description:
      '해파리를 봤는가. **false(못 봤다)도 반드시 기록한다** — 그 기록이 없으면 오경보를 셀 수 없다.',
  })
  @IsBoolean()
  jellyfishPresent!: boolean;

  @ApiPropertyOptional({
    enum: DENSITY_LEVELS,
    example: 'low',
    description:
      '관측 밀도. `jellyfishPresent=true` 면 **필수**, false 면 넣을 수 없다(넣으면 400).',
  })
  @IsOptional()
  @IsIn(DENSITY_LEVELS as readonly string[])
  densityLevel?: DensityLevel;

  @ApiPropertyOptional({ example: 3, minimum: 1, description: '확인된 해파리 종 id(도감).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  speciesId?: number;

  @ApiPropertyOptional({
    example: 12,
    minimum: 0,
    description: '눈으로 센 추정 개체 수. 정밀한 값이 아니어도 된다.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedCount?: number;

  @ApiPropertyOptional({ example: '김안전', maxLength: 50, description: '관측자 이름(계정과 별개).' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  observerName?: string;

  @ApiPropertyOptional({ example: '수온 26도, 파도 잔잔. 동쪽 끝에서만 확인.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordFieldObservationResponse {
  @ApiProperty({ example: 101 })
  observationId!: number;
}

// ── 쏘임 사고 ───────────────────────────────────────────────────────────────────────

export class RecordStingIncidentRequest {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  beachId!: number;

  @ApiProperty({
    example: '2026-08-20T05:20:00Z',
    description: '사고가 일어난 시각(ISO 8601). 119 연계는 늦게 들어오므로 과거 시각이 정상이다.',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiProperty({
    enum: INCIDENT_SOURCES,
    example: 'emergency_call',
    description: '사고를 알려온 경로. 중복 유입을 가려내는 데 쓴다.',
  })
  @IsIn(INCIDENT_SOURCES as readonly string[])
  source!: IncidentSource;

  @ApiProperty({
    enum: STING_SEVERITIES,
    example: 'moderate',
    description:
      '피해 정도. mild(현장 처치) / moderate(병원 이송) / severe(입원) / fatal(사망). 의학적 중증도 분류가 아니라 운영 판단용 구분이다.',
  })
  @IsIn(STING_SEVERITIES as readonly string[])
  severity!: StingSeverity;

  @ApiProperty({ example: 2, minimum: 1, maximum: 1000, description: '피해자 수. 1명 이상이어야 한다.' })
  @IsInt()
  @Min(1)
  @Max(1000)
  patientCount!: number;

  @ApiPropertyOptional({ example: 3, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  speciesId?: number;

  @ApiPropertyOptional({
    example: 'FIRE-2026-0820-0031',
    maxLength: 100,
    description:
      '외부 기관 사건 식별자. 같은 사고가 두 경로로 들어올 때 묶는 열쇠다. **자동 병합은 하지 않고** 중복 가능성만 알려 준다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalRef?: string;

  @ApiPropertyOptional({ example: '입수 통제 전 발생. 현장 응급처치 후 이송.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RecordStingIncidentResponse {
  @ApiProperty({ example: 55 })
  incidentId!: number;

  @ApiProperty({
    example: false,
    description:
      '같은 외부 식별자의 사고가 이미 있었는가. true 여도 **저장은 됐다** — 사람이 중복인지 확인한다.',
  })
  possibleDuplicate!: boolean;
}

// ── 목록 조회 ───────────────────────────────────────────────────────────────────────

export class GroundtruthListQuery {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;

  @ApiPropertyOptional({ example: '2026-08-01', description: 'KST 기준 시작일(포함).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'KST 기준 종료일(포함).' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: OBSERVATION_SOURCES })
  @IsOptional()
  @IsIn(OBSERVATION_SOURCES as readonly string[])
  source?: ObservationSource;

  @ApiPropertyOptional({
    example: false,
    description: 'true 면 출현한 관측만, false 면 **부재 관측만** 본다.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  jellyfishPresent?: boolean;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}

// ── 정확도 ──────────────────────────────────────────────────────────────────────────

export class AccuracyQuery {
  @ApiPropertyOptional({ example: '2026-07-01', description: 'KST 기준 시작일(포함).' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'KST 기준 종료일(포함).' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beachId?: number;
}

class AccuracySummaryResponse {
  @ApiProperty({
    example: { hit: 12, miss: 2, false_alarm: 5, correct_negative: 140 },
    description: '혼동 행렬 네 칸. **miss(경보 안 했는데 위험했다)가 가장 나쁜 값**이다.',
  })
  counts!: Record<string, number>;

  @ApiProperty({ example: 159, description: '평가한 (해변 × 일) 수.' })
  total!: number;

  @ApiProperty({
    example: 0.857,
    nullable: true,
    description:
      '재현율 = 위험했던 날 중 경보한 비율. **분모가 0 이면 null 이다** — 0 으로 두면 "완벽함" 과 "잴 수 없음" 이 구분되지 않는다.',
  })
  recall!: number | null;

  @ApiProperty({ example: 0.706, nullable: true, description: '정밀도 = 경보한 날 중 실제 위험했던 비율.' })
  precision!: number | null;

  @ApiProperty({ example: 0.034, nullable: true, description: '오경보율 = 안전했던 날 중 경보한 비율.' })
  falseAlarmRate!: number | null;
}

class BeachAccuracyResponse extends AccuracySummaryResponse {
  @ApiProperty({ example: 1 })
  beachId!: number;

  @ApiProperty({ example: '협재해수욕장' })
  beachName!: string;
}

export class AccuracyReportResponse {
  @ApiProperty({ type: AccuracySummaryResponse })
  overall!: AccuracySummaryResponse;

  @ApiProperty({
    type: [BeachAccuracyResponse],
    description:
      '해변별 요약. **해변 단위 변별력을 보는 유일한 창**이다 — 기존 백테스트는 정답이 시군구 단위라 협재와 함덕을 구분할 수 없었다(docs/backtest.md). 놓친 날이 많은 해변부터 나온다.',
  })
  byBeach!: BeachAccuracyResponse[];

  @ApiProperty({
    enum: RISK_LEVELS,
    example: 'danger',
    description: '판정에 쓴 경보 임계선. 이 값이 다르면 다른 기간과 비교할 수 없다.',
  })
  alertThreshold!: RiskLevel;
}

export class EvaluatePredictionsRequest {
  @ApiPropertyOptional({ example: '2026-08-19', description: 'KST 시작일. 미지정 시 어제 하루.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-19', description: 'KST 종료일.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class EvaluatePredictionsResponse {
  @ApiProperty({ example: 12, description: '판정해 저장한 (해변 × 날짜) 수.' })
  evaluated!: number;

  @ApiProperty({
    example: 3,
    description: '예측은 있는데 관측·사고가 없어 판정하지 못한 수. 아무도 보지 않은 날이다.',
  })
  skippedNoActual!: number;

  @ApiProperty({
    example: 0,
    description:
      '실제 관측은 있는데 그날 예측이 없어 판정하지 못한 수. **0 이 아니면 그 기간 산출 배치가 멎어 있었다는 뜻이다.**',
  })
  skippedNoPrediction!: number;

  @ApiProperty({ enum: EVALUATION_OUTCOMES, isArray: true, required: false })
  outcomes?: string[];
}
