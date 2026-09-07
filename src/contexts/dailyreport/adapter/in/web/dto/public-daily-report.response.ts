import { ApiProperty } from '@nestjs/swagger';

/** 등급이 오른 해변 하나. */
export class RaisedBeachResponse {
  @ApiProperty({ example: 3, description: '해변 id' }) beachId!: number;
  @ApiProperty({ example: '함덕해수욕장' }) name!: string;

  @ApiProperty({ example: 'caution', enum: ['safe', 'caution', 'danger', 'severe'] })
  from!: string;

  @ApiProperty({ example: 'danger', enum: ['safe', 'caution', 'danger', 'severe'] })
  to!: string;

  @ApiProperty({ example: '주의', description: '표시용 한글 라벨' }) fromLabel!: string;
  @ApiProperty({ example: '위험', description: '표시용 한글 라벨' }) toLabel!: string;
}

/** 독성 의심 제보가 있었던 해변 하나. */
export class ToxicBeachResponse {
  @ApiProperty({ example: 5, description: '해변 id' }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;
  @ApiProperty({ example: 2, description: '그날 독성 의심으로 분류된 제보 수' }) toxicCount!: number;
}

/** 운영기관 코멘트 하나. */
export class PublicCommentResponse {
  @ApiProperty({ example: 5, description: '해변 id' }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;

  @ApiProperty({
    example: '오후 입수 통제 중입니다. 안전요원 안내에 따라 주세요.',
    description: '운영기관이 **공개를 선택해** 남긴 안내. 내부 메모는 여기 나오지 않는다.',
  })
  comment!: string;
}

/** 등급별 해변 수. */
export class LevelCountsResponse {
  @ApiProperty({ example: 4, description: '낮음' }) safe!: number;
  @ApiProperty({ example: 5, description: '주의' }) caution!: number;
  @ApiProperty({ example: 2, description: '위험' }) danger!: number;
  @ApiProperty({ example: 0, description: '매우 위험' }) severe!: number;

  @ApiProperty({
    example: 1,
    description: [
      '**그날 위험도가 한 번도 산출되지 않은 해변 수.** 관측이 끊겼거나 보관 기간이 지난 경우다.',
      '`safe` 에 합치지 않는다 — "모른다" 를 "안전하다" 로 보여주면 화면이 실제보다 안전해 보인다.',
    ].join(' '),
  })
  unknown!: number;
}

/** 그날 총계. */
export class DailyTotalsResponse {
  @ApiProperty({ example: 14, description: '그날 접수된 제보 수(제주 전체)' }) reportCount!: number;
  @ApiProperty({ example: 3, description: '독성 의심 제보 수' }) toxicCount!: number;
  @ApiProperty({ example: 1, description: '쏘임 사고 제보 수' }) stingCount!: number;
}

/**
 * 이슈 #56 GET /public/daily-report 응답 — **오늘 제주 해파리 상황 한 장.**
 *
 * 관리자 일간 리포트(`/admin/daily-reports`)와 다른 계약이다. 그쪽은 해변 하나의 하루이고
 * 내부 메모·검수 값이 섞여 있다. 이 응답에는 **운영자가 공개를 선택한 값만** 담긴다.
 */
export class PublicDailyReportResponse {
  @ApiProperty({
    example: '2026-09-06',
    description: '기준 일자(YYYY-MM-DD, KST). 집계 구간은 그날 KST 00:00~24:00.',
  })
  reportDate!: string;

  @ApiProperty({
    example: '2026-09-06T07:20:11.482Z',
    description: [
      '이 요약을 만든 시각(UTC). 응답은 캐시되므로 방금 값이 아닐 수 있다 —',
      '화면에 "몇 시 기준" 을 표시할 때 이 값을 쓴다.',
    ].join(' '),
  })
  generatedAt!: string;

  @ApiProperty({
    example: 'danger',
    enum: ['safe', 'caution', 'danger', 'severe'],
    nullable: true,
    description: '제주 전체에서 그날 가장 높았던 등급. 산출 이력이 하나도 없으면 null.',
  })
  maxRiskLevel!: string | null;

  @ApiProperty({
    example: '위험',
    description: "표시용 한글 라벨. 산출 이력이 없으면 '정보 없음' 이다(빈 문자열이 아니다).",
  })
  maxRiskLabel!: string;

  @ApiProperty({ example: 12, description: '집계 대상 해변 수(운영 중인 해변)' })
  beachCount!: number;

  @ApiProperty({
    type: LevelCountsResponse,
    description: [
      '등급별 해변 수. 각 해변의 **그날 최고 등급**으로 센다.',
      '',
      '마지막 등급으로 세지 않는 이유 — 낮에 위험했다가 저녁에 내려간 해변이 "낮음" 칸에 들어가',
      '그날 위험했다는 사실이 사라진다. 등급 변화는 `raisedBeaches` 가 따로 보여 준다.',
    ].join('\n'),
  })
  levelCounts!: LevelCountsResponse;

  @ApiProperty({
    type: [RaisedBeachResponse],
    description: '그날 등급이 **오른** 해변(첫 산출 < 마지막 산출). 높은 등급부터 정렬한다.',
  })
  raisedBeaches!: RaisedBeachResponse[];

  @ApiProperty({
    type: [ToxicBeachResponse],
    description: '독성 의심 제보가 있었던 해변. 건수가 많은 곳부터 정렬한다.',
  })
  toxicBeaches!: ToxicBeachResponse[];

  @ApiProperty({
    type: [PublicCommentResponse],
    description: [
      '운영기관이 공개한 안내 문구. 없으면 빈 배열이다.',
      '',
      '⚠️ 관리자 리포트의 **내부 메모(`memo`)는 여기 나오지 않는다.** 그 값은 공개를 전제하지 않고',
      '쓰였으므로 소급 공개하지 않는다. 운영자가 공개용으로 따로 작성한 코멘트만 담긴다.',
    ].join('\n'),
  })
  comments!: PublicCommentResponse[];

  @ApiProperty({ type: DailyTotalsResponse, description: '그날 제보 총계(제주 전체)' })
  totals!: DailyTotalsResponse;
}
