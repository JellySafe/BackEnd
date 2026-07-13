import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { ValidationError } from '@shared/kernel/domain-error';
import { UploadImageResponse } from './dto/upload-image.response';

/**
 * 업로드된 파일의 최소 구조(Multer). @types/multer 미설치 환경에서도
 * 타입이 성립하도록 사용하는 필드만 국소적으로 선언한다.
 */
interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/** 프로젝트 루트 기준 업로드 폴더. */
const UPLOAD_DIR = join(process.cwd(), 'uploads');
/** 허용 이미지 확장자(원본 확장자 정규화용). */
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']);

/**
 * 제보 이미지 업로드 API (USR-004 보완).
 * multipart/form-data 의 image 파일을 로컬 uploads/ 폴더에 저장하고
 * 제보 작성(POST /public/reports)에 넣을 imageUrl 을 돌려준다.
 * 비로그인 제보를 지원하므로 public 이며 인증이 필요 없다.
 */
@ApiTags('report')
@Controller('public/reports')
export class ReportUploadController {
  /** USR-004 제보 이미지 업로드 */
  @Post('image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
      required: ['image'],
    },
  })
  @ApiOkData(UploadImageResponse)
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile() file?: UploadedImageFile,
  ): Promise<{ imageUrl: string; thumbnailUrl: string | null }> {
    if (!file) {
      throw new ValidationError('UPLOAD_IMAGE_REQUIRED', '업로드할 이미지 파일이 필요합니다.');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new ValidationError('UPLOAD_IMAGE_INVALID_TYPE', '이미지 파일만 업로드할 수 있습니다.');
    }

    const rawExt = extname(file.originalname ?? '').toLowerCase();
    const ext = ALLOWED_EXT.has(rawExt) ? rawExt : '.jpg';
    // 충돌 방지: 타임스탬프 + 난수 + 원본 확장자.
    const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, filename), file.buffer);

    // 정적 서빙 경로 규약(/uploads/*). 실제 CDN/스토리지 연동 시 이 매핑만 교체.
    const imageUrl = `/uploads/${filename}`;
    return { imageUrl, thumbnailUrl: null };
  }
}
