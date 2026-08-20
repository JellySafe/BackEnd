import { ApiProperty } from '@nestjs/swagger';

/**
 * POST /public/reports/image/presign 응답.
 */
export class PresignUploadResponse {
  @ApiProperty({
    example: 'https://bucket.s3.ap-northeast-2.amazonaws.com/reports/2026/08/20/1755648000000-a1b2c3d4.jpg?X-Amz-Signature=...',
    description: '이 URL 로 **PUT** 한다(본문은 사진 바이트 그대로). 만료되면 다시 발급받는다.',
  })
  uploadUrl!: string;

  @ApiProperty({
    example: 'image/jpeg',
    description: 'PUT 요청의 `Content-Type` 헤더에 **정확히 이 값**을 넣는다. 다르면 서명이 맞지 않아 거부된다.',
  })
  contentType!: string;

  @ApiProperty({
    example: 'https://cdn.jellysafe.kr/reports/2026/08/20/1755648000000-a1b2c3d4.jpg',
    description: '업로드가 끝나면 제보 접수(`POST /public/reports`)의 `imageUrl` 에 넣는 값.',
  })
  imageUrl!: string;

  @ApiProperty({
    example: 300,
    description: 'uploadUrl 유효 시간(초). 이 시간이 지나면 업로드가 거부된다.',
  })
  expiresInSeconds!: number;
}
