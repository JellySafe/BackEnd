import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** 사전 서명 업로드에서 허용하는 형식. detectImage 가 받아들이는 목록과 같다(SVG 제외). */
export const PRESIGNABLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
] as const;

/**
 * POST /public/reports/image/presign 요청.
 */
export class PresignUploadRequest {
  @ApiProperty({
    enum: PRESIGNABLE_MIME_TYPES,
    example: 'image/jpeg',
    description:
      '올릴 사진의 형식. 이 값으로 서명하므로 **PUT 할 때 같은 `Content-Type` 헤더를 보내야** 한다(다르면 스토리지가 거부한다).',
  })
  @IsIn(PRESIGNABLE_MIME_TYPES as readonly string[])
  contentType!: string;
}
