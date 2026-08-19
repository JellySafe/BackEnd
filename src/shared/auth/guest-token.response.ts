import { ApiProperty } from '@nestjs/swagger';

/** POST /public/guest-tokens 응답. */
export class GuestTokenResponse {
  @ApiProperty({
    example: 'gV1sYQ2n8Kd0pZ7mR4tXbw.9fH2kLm3QaZ1cV8nT0yPxw',
    description:
      '비로그인 사용자 식별 토큰(46자 고정). 기기에 저장해 두고 이후 요청마다 같은 값을 보낸다.',
  })
  userToken!: string;
}
