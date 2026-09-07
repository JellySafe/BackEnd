import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PUBLIC_COMMENT_MAX_LENGTH } from '../../../../domain/daily-report';

/**
 * 이슈 #56 PATCH /admin/daily-reports/:id/public-comment 요청.
 *
 * ⚠️ 내부 메모(`PATCH :id/memo`)와 **다른 API 다.** 이 값은 시민 화면에 그대로 나간다.
 * 두 경로를 나눠 둔 것이 안전장치다 — 하나의 요청에서 필드 이름을 헷갈려 내부 메모가
 * 공개되는 사고가 일어날 자리를 없앤다.
 */
export class UpdatePublicCommentRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '오후 입수 통제 중입니다. 안전요원 안내에 따라 주세요.',
    maxLength: PUBLIC_COMMENT_MAX_LENGTH,
    description: [
      '**시민에게 그대로 공개되는** 운영기관 안내 문구. 담당자 이름·내부 확인 사항은 쓰지 않는다',
      '(그런 내용은 `PATCH :id/memo` 의 내부 메모에 남긴다).',
      '',
      'null 이나 빈 문자열을 보내면 **공개를 내린다.** 잘못 올라간 글을 즉시 내리는 수단이다.',
    ].join(' '),
  })
  @IsOptional()
  @IsString()
  @MaxLength(PUBLIC_COMMENT_MAX_LENGTH)
  comment?: string | null;
}
