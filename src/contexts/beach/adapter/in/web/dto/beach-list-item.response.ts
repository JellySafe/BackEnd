import { ApiProperty } from '@nestjs/swagger';

/** USR-001 공개 해변 목록 한 행 응답 (BeachListItem 미러). */
export class BeachListItemResponse {
  @ApiProperty({ example: 1 }) beachId!: number;
  @ApiProperty({ example: '협재해수욕장' }) name!: string;
  @ApiProperty({ example: '제주시' }) region!: string;
  @ApiProperty({ example: 33.3941 }) lat!: number;
  @ApiProperty({ example: 126.2396 }) lng!: number;
  @ApiProperty({ example: 'danger', nullable: true }) currentRiskLevel!: string | null;
  @ApiProperty({
    example: 'https://cdn.example.com/beaches/hyeopjae.jpg',
    nullable: true,
    description: '해변 대표 사진 URL. 미등록이면 null — 앱에서 기본 placeholder 로 대체한다.',
  })
  imageUrl!: string | null;
  @ApiProperty({ example: 1 }) priority!: number;
}
