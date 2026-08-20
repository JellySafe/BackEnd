import { Body, Controller, Inject, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { UnavailableError, ValidationError } from '@shared/kernel/domain-error';
import {
  ReportImageStoragePort,
  REPORT_IMAGE_STORAGE,
} from '../../../application/port/out/report-image-storage.port';
import { detectImage, extensionOfMimeType } from './image-signature';
import { UploadImageResponse } from './dto/upload-image.response';
import { PresignUploadRequest } from './dto/presign-upload.request';
import { PresignUploadResponse } from './dto/presign-upload.response';

/**
 * 업로드된 파일의 최소 구조(Multer). @types/multer 미설치 환경에서도
 * 타입이 성립하도록 사용하는 필드만 국소적으로 선언한다.
 */
interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * 업로드 허용 최대 크기(바이트).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 예전에는 limits 를 주지 않아 multer 기본값(무제한)이 적용됐고, 파일 전체가 **메모리 버퍼**로
 * 올라왔다. 운영 머신은 512MB(shared-cpu-1x) 다. 인증이 필요 없는 이 경로에 큰 요청 하나면
 * 프로세스가 OOM 으로 죽는다. 레이트 리밋은 요청 '횟수'만 제한하지 바이트를 막지 못한다.
 *
 * ── 왜 12MB 인가 ─────────────────────────────────────────────────────────────────────
 * 최신 휴대폰 카메라 원본이 가장 큰 입력이다. 4800만 화소 JPEG 이 8~10MB, HEIC 는 더 작다.
 * 12MB 면 원본을 리사이즈 없이 올려도 통과하면서, 동시 업로드가 몰려도 메모리가 버틴다
 * (레이트 리밋 REPORT_BURST 10회/분 × 12MB = 최악 120MB).
 * 초과 시 multer 가 LIMIT_FILE_SIZE 를 내고 Nest 가 413 으로 변환한다.
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * 제보 이미지 업로드 API (USR-004 보완).
 * multipart/form-data 의 image 파일을 로컬 uploads/ 폴더에 저장하고
 * 제보 작성(POST /public/reports)에 넣을 imageUrl 을 돌려준다.
 * 비로그인 제보를 지원하므로 public 이며 인증이 필요 없다.
 */
@ApiTags('report')
@Controller('public/reports')
export class ReportUploadController {
  constructor(
    @Inject(REPORT_IMAGE_STORAGE) private readonly storage: ReportImageStoragePort,
  ) {}

  /** USR-004 제보 이미지 업로드 */
  @ApiOperation({
    summary: '[앱] 제보 사진 업로드 — 제보 제출 전에 먼저 호출 (2단계 중 1단계)',
    description: [
      '제보 사진을 서버에 올리고 `imageUrl` 을 돌려받는다. 그 값을 `POST /public/reports` 의 body 에 넣는다.',
      '',
      '- `multipart/form-data` 로 보내고, 파일 필드 이름은 **`image`** 여야 한다.',
      '- 이미지 파일만 허용(jpg, png, gif, webp, heic). **파일 내용으로 판별**하므로',
      '  확장자나 Content-Type 만 바꿔서는 통과하지 않는다(400 `UPLOAD_IMAGE_INVALID_TYPE`).',
      '- 최대 **12MB**. 초과하면 413 이다(휴대폰 카메라 원본은 보통 10MB 미만이라 그대로 올려도 된다).',
      '- 인증 불필요(비로그인 제보 지원). 단, 남용 방지를 위해 IP 당 레이트 리밋이 걸린다(초과 시 429).',
      '',
      '서버의 `UPLOAD_DIR`(운영은 영구 볼륨)에 저장하고 `/uploads/파일명` 경로를 준다.',
      '그 경로는 API 프리픽스(`/api`) 없이 그대로 열린다 — 예: `https://<host>/uploads/1720000000-abcd.jpg`.',
      '추후 S3/CDN 으로 바꿔도 응답 형태는 그대로다.',
      '',
      '**썸네일은 만들지 않는다.** 응답의 `thumbnailUrl` 은 항상 null 이며,',
      '이미지를 표시하는 쪽(앱/관리자)은 `thumbnailUrl ?? imageUrl` 로 폴백한다.',
    ].join('\n'),
  })
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
  @UseInterceptors(
    // 파일 1개, 12MB 상한. 상한을 넘으면 multer 가 스트림을 끊고 Nest 가 413 을 낸다
    // (버퍼가 메모리에 다 쌓인 뒤가 아니라 읽는 도중에 끊긴다 — OOM 방어의 핵심).
    FileInterceptor('image', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  async uploadImage(
    @UploadedFile() file?: UploadedImageFile,
  ): Promise<{ imageUrl: string; thumbnailUrl: string | null }> {
    if (!file) {
      throw new ValidationError('UPLOAD_IMAGE_REQUIRED', '업로드할 이미지 파일이 필요합니다.');
    }

    // 형식은 **파일 내용**으로 판별한다. mimetype 헤더와 원본 확장자는 클라이언트가 주장하는
    // 값이라 검증 근거가 못 된다(image-signature.ts 참고). 저장 확장자도 판별 결과에서 뽑아
    // 파일 내용과 확장자가 어긋날 여지를 없앤다.
    const detected = detectImage(file.buffer);
    if (detected === null) {
      throw new ValidationError(
        'UPLOAD_IMAGE_INVALID_TYPE',
        '이미지 파일만 업로드할 수 있습니다(jpg, png, gif, webp, heic).',
      );
    }

    // 저장 위치·파일명 규칙은 저장소 어댑터가 정한다(로컬 볼륨 또는 S3 호환).
    // 컨트롤러가 직접 파일을 쓰면 저장소를 바꿀 때 쓰기 경로가 남는다.
    const stored = await this.storage.save(file.buffer, {
      extension: detected.extension,
      mimeType: detected.mimeType,
    });

    // 썸네일은 생성하지 않는다(의도적). 판단 근거:
    //  - 이미지 리사이즈에는 네이티브 모듈(sharp/libvips)이 필요하다. 컨테이너는 돌지만
    //    런타임 이미지가 수십 MB 커지고, 빌드/런너 두 스테이지 모두 영향을 받는다.
    //  - 저장 파일이 원본 + 썸네일 2배가 된다. 운영 볼륨은 1GB 다.
    //  - 얻는 것이 적다: 관리자 목록은 페이지당 20건이고, 표시 크기 제한 + lazy loading 으로 충분하다.
    //  - S3/CDN 으로 옮긴 뒤에는 **CDN 의 이미지 변환**(요청 시 리사이즈)이 더 낫다. 원본 하나만
    //    보관하면서 필요한 크기를 그때 만들므로, 저장 용량도 파기 대상도 늘지 않는다.
    // 클라이언트는 `thumbnailUrl ?? imageUrl` 로 폴백한다. thumbnail_url 컬럼은 그 자리로 남겨 둔다.
    return stored;
  }

  /** USR-004 제보 이미지 사전 서명 업로드 (S3 드라이버 전용) */
  @ApiOperation({
    summary: '[앱] 제보 사진 업로드용 사전 서명 URL 발급 — 스토리지로 직접 올린다',
    description: [
      '서버를 거치지 않고 오브젝트 스토리지에 **직접** 올릴 1회용 URL 을 받는다.',
      '응답의 `uploadUrl` 로 `PUT` 하고(헤더 `Content-Type` 은 응답의 `contentType` 과 정확히 일치해야 한다),',
      '올린 뒤 `imageUrl` 을 제보 접수에 넣는다.',
      '',
      '**언제 쓰나** — 큰 사진을 올릴 때. 서버 경유 업로드(`POST /public/reports/image`)는 파일이',
      '앱 메모리를 지나가지만, 이 방식은 그렇지 않다. 회선이 느린 모바일에서도 서버 타임아웃과 무관하다.',
      '',
      '**주의**',
      '- `S3` 드라이버가 아닌 환경(로컬 볼륨 저장)에서는 503 이다. 그때는 서버 경유 업로드를 쓴다.',
      '- 서버가 파일 내용을 보지 못하므로, **제보 접수 시점에 서버가 저장된 객체를 되짚어 검사한다.**',
      '  이미지가 아니면 그 제보는 400 으로 거부된다(형식 위조를 막는 지점이 뒤로 밀렸을 뿐 사라지지 않았다).',
      '- URL 은 짧게 만료된다(기본 5분). 만료 후에는 다시 발급받는다.',
    ].join('\n'),
  })
  @ApiOkData(PresignUploadResponse)
  @Post('image/presign')
  async presignUpload(@Body() body: PresignUploadRequest): Promise<PresignUploadResponse> {
    // 형식은 클라이언트가 "무엇을 올릴 것인지" 알려주는 값이다. 여기서는 우리가 허용하는
    // 형식 목록 안에 있는지만 확인하고, **실제 내용 검사는 제보 접수 때** 한다(위 설명 참고).
    const extension = extensionOfMimeType(body.contentType);
    if (extension === null) {
      throw new ValidationError(
        'UPLOAD_IMAGE_INVALID_TYPE',
        '이미지 형식만 업로드할 수 있습니다(jpg, png, gif, webp, heic).',
      );
    }

    const presigned = await this.storage.presignUpload({ extension, mimeType: body.contentType });
    if (presigned === null) {
      throw new UnavailableError(
        'PRESIGNED_UPLOAD_UNAVAILABLE',
        '이 환경은 사전 서명 업로드를 지원하지 않습니다. POST /public/reports/image 로 올려주세요.',
      );
    }
    return presigned;
  }
}
