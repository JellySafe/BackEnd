import { ApiProperty } from '@nestjs/swagger';

/**
 * AUTH-001 GET /admin/auth/session 응답 (이슈 #55).
 *
 * 프론트의 Next middleware 가 **서버에서** 세션을 확인하는 데 쓴다. 지금 관리자 앱의 라우트
 * 가드는 클라이언트 전용이라 우회가 가능한데, middleware 는 쿠키를 읽어 이 엔드포인트로
 * 물어볼 수 있다. 200 이면 유효한 세션, 401 이면 로그인으로 보내면 된다.
 */
export class SessionResponse {
  @ApiProperty({ example: 1, description: '사용자 id' })
  userId!: number;

  @ApiProperty({ example: 'admin@jellysafe.local' })
  email!: string;

  @ApiProperty({
    example: 'admin',
    enum: ['public', 'operator', 'admin'],
    description: '역할. 관리자 웹 메뉴 노출 제어에 쓴다.',
  })
  role!: string;

  @ApiProperty({
    example: 'cookie',
    enum: ['cookie', 'bearer'],
    description: [
      '이 요청이 **무엇으로 인증됐는지**. 쿠키 전환이 실제로 먹었는지 확인하는 용도다.',
      '`bearer` 가 나온다면 아직 JS 가 토큰을 들고 있다는 뜻이므로, 그 코드가 남아 있는 것이다.',
    ].join(' '),
  })
  authVia!: 'cookie' | 'bearer';
}
