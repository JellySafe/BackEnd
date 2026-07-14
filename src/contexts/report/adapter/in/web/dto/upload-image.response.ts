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
    description: [
      '썸네일 URL. **서버는 썸네일을 생성하지 않으므로 항상 null 이다.**',
      '이미지를 보여줄 때는 `thumbnailUrl ?? imageUrl` 로 폴백할 것.',
      '(필드를 남겨두는 이유: jellyfish_reports.thumbnail_url 컬럼이 존재하고,',
      ' 추후 S3/CDN 파생 URL 로 채울 자리이기 때문이다.)',
    ].join(' '),
    nullable: true,
  })
  thumbnailUrl!: string | null;
}
