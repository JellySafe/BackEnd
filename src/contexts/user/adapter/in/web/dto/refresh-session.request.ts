import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * AUTH-001 POST /admin/auth/refresh 요청.
 * 액세스 토큰은 만료됐어도 되므로 헤더가 아니라 본문으로 받는다.
 */
export class RefreshSessionRequest {
  @ApiProperty({
    example: 'rZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbA',
    minLength: 44,
    maxLength: 44,
    description: '로그인 응답에서 받은 refreshToken. 재발급에 성공하면 이 값은 즉시 무효가 된다.',
  })
  @IsString()
  @Length(44, 44)
  refreshToken!: string;
}
