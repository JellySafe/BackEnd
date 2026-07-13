import { ApiProperty } from '@nestjs/swagger';

/** USR-003 관심 해변 저장 결과 응답 (AddFavoriteResult 미러). */
export class AddFavoriteResponse {
  @ApiProperty({ example: 1 }) favoriteId!: number;
  @ApiProperty({ example: 1 }) beachId!: number;
}
