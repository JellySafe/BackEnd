import { ApiProperty } from '@nestjs/swagger';

/** USR-004 POST /public/reports 응답 (SubmitReportResult 미러링). */
export class SubmitReportResponse {
  @ApiProperty({ example: 1024, description: '생성된 제보 식별자' })
  reportId!: number;

  @ApiProperty({
    example: 'received',
    description: '제보 처리 상태',
    enum: ['received', 'ai_processing', 'ai_done', 'verified', 'rejected', 'hold', 'reflected'],
  })
  status!: string;

  @ApiProperty({ example: 'pending', description: 'AI 판별 대기 상태' })
  aiStatus!: string;

  @ApiProperty({
    example: 2,
    description:
      '이 제보가 반영될 해변 id. `beachId` 를 보내지 않았어도 좌표가 활성 해변 2km 이내면 서버가 최근접 해변을 자동 배정한다. 배정되지 않으면 null 이며, 그 제보는 위험도 산출에 반영되지 않는다.',
    nullable: true,
  })
  beachId!: number | null;

  @ApiProperty({ example: '함덕해수욕장', description: '배정된 해변명', nullable: true })
  beachName!: string | null;

  @ApiProperty({
    example: 'auto',
    description:
      '해변이 정해진 방식. `user`=사용자가 직접 고름(요청의 beachId 를 그대로 씀) / `auto`=좌표로 최근접 해변 자동 배정 / `none`=반경(2km) 밖이라 배정 안 됨.',
    enum: ['user', 'auto', 'none'],
  })
  beachAssignment!: string;

  @ApiProperty({
    example: 0.054,
    description: '자동 배정된 경우 제보 좌표 ↔ 해변 중심점 직선거리(km). 그 외에는 null.',
    nullable: true,
  })
  beachDistanceKm!: number | null;
}
