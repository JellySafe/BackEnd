import { ApiProperty } from '@nestjs/swagger';

/** ADM-008 GET /admin/reports 목록 한 행 (ReportListItem 미러링). */
export class ReportListItemResponse {
  @ApiProperty({ example: 19, description: '제보 식별자' })
  reportId!: number;

  @ApiProperty({
    example: 1,
    description:
      '배정된 해변 id. 사용자가 해변을 골랐거나, 좌표가 활성 해변 2km 이내라 자동 배정된 경우 채워진다. 반경 밖이면 null(위험도에 반영되지 않는다).',
    nullable: true,
  })
  beachId!: number | null;

  @ApiProperty({ example: '협재해수욕장', description: '배정된 해변명', nullable: true })
  beachName!: string | null;

  @ApiProperty({
    example: 33.3941,
    description: '배정된 해변의 위도(지도에 해변 마커용). beachId 가 null 이면 null.',
    nullable: true,
  })
  beachLat!: number | null;

  @ApiProperty({
    example: 126.2396,
    description: '배정된 해변의 경도. beachId 가 null 이면 null.',
    nullable: true,
  })
  beachLng!: number | null;

  @ApiProperty({
    example: 33.3938,
    description:
      '제보 좌표(위도). 지도 마커에 그대로 쓴다. PRIV-003 보관기간(90일) 만료로 파기됐으면 null.',
    nullable: true,
  })
  lat!: number | null;

  @ApiProperty({
    example: 126.2402,
    description: '제보 좌표(경도). 파기됐으면 null.',
    nullable: true,
  })
  lng!: number | null;

  @ApiProperty({
    example: 4,
    description:
      '해변이 배정되지 않은 제보(beachId=null)의 위치 맥락 — 좌표에서 가장 가까운 활성 해변 id. 자동 배정 반경(2km) 밖이라 배정되지 않았다는 뜻이다. 주소 정보는 스키마에 없어 제공하지 않는다.',
    nullable: true,
  })
  nearestBeachId!: number | null;

  @ApiProperty({
    example: '중문색달해수욕장',
    description: '가장 가까운 활성 해변명 (beachId 가 null 일 때만 채워진다).',
    nullable: true,
  })
  nearestBeachName!: string | null;

  @ApiProperty({
    example: 13.415,
    description:
      '가장 가까운 활성 해변까지의 거리(km, 직선). beachId 가 null 일 때만 채워지며 항상 2km 를 넘는다.',
    nullable: true,
  })
  nearestBeachDistanceKm!: number | null;

  @ApiProperty({
    example: 'sting',
    description: '제보 유형',
    enum: ['general', 'multiple', 'sting'],
  })
  reportType!: string;

  @ApiProperty({
    example: 'ai_done',
    description: '제보 처리 상태',
    enum: ['received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'],
  })
  status!: string;

  @ApiProperty({
    example: 'toxic_suspected',
    description: 'AI 판별 결과',
    enum: ['normal', 'toxic_suspected', 'unknown'],
    nullable: true,
  })
  aiResult!: string | null;

  @ApiProperty({ example: 0.87, description: 'AI 판별 신뢰도(0~1)', nullable: true })
  aiConfidence!: number | null;

  @ApiProperty({
    example: '/uploads/1784018113485-8afb351da8e4d6a7.png',
    description:
      '제보 사진 원본 URL. **검수 화면은 이 값을 쓴다.** API 프리픽스 없이 그대로 열린다(예: https://<host>/uploads/...). PRIV-003 파기된 제보는 null.',
    nullable: true,
  })
  imageUrl!: string | null;

  @ApiProperty({
    example: null,
    description:
      '썸네일 URL. **현재 업로드 파이프라인은 썸네일을 생성하지 않으므로 사실상 항상 null 이다.** 프론트는 `thumbnailUrl ?? imageUrl` 로 폴백할 것. (필드를 유지하는 이유: 스키마 컬럼이 존재하고, 추후 S3/CDN 파생 URL 을 채울 자리다.)',
    nullable: true,
  })
  thumbnailUrl!: string | null;

  @ApiProperty({ example: '2026-07-13T23:35:14.000Z', description: '제보 접수 일시' })
  submittedAt!: string;
}
