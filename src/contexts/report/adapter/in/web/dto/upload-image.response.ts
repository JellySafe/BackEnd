import { ApiProperty } from '@nestjs/swagger';

/** USR-004 POST /public/reports/image 업로드 응답. */
export class UploadImageResponse {
  @ApiProperty({
    example: '/uploads/1720600000000-a1b2c3d4e5f6a7b8.jpg',
    description: '저장된 이미지 URL (제보 작성 시 imageUrl 로 사용)',
  })
  imageUrl!: string;

  @ApiProperty({
    example: null,
    description: '썸네일 URL (미생성 시 null)',
    nullable: true,
  })
  thumbnailUrl!: string | null;
}
