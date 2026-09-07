import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/refresh 요청.
 *
 * 액세스 토큰은 만료됐어도 되므로 헤더가 아니라 **본문 또는 쿠키**로 받는다.
 *
 * `refreshToken` 이 선택인 이유 — 브라우저는 `js_refresh_token` **쿠키**로 보내고(이슈 #55),
 * 그때 본문은 비어 있다(`{}`). 반대로 Swagger·운영 스크립트는 쿠키가 없으므로 본문에 담는다.
 * 둘 다 없으면 400 이다(어느 쪽으로도 토큰이 오지 않았다는 뜻이라 서버가 할 수 있는 일이 없다).
 */
export class RefreshSessionRequest {
  @ApiPropertyOptional({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    minLength: 44,
    maxLength: 44,
    description: [
      '로그인 응답에서 받은 refreshToken. 재발급에 성공하면 이 값은 즉시 무효가 된다.',
      '**브라우저(관리자 웹)는 보내지 않는다** — 쿠키로 자동 전송되며, 본문 값이 있으면 그쪽이 우선한다.',
    ].join(' '),
  })
  @IsOptional()
  @IsString()
  @Length(44, 44)
  refreshToken?: string;
}
