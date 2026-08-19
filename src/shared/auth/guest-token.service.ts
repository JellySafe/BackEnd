import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUEST_TOKEN_LENGTH, issueGuestToken, verifyGuestToken } from './guest-token';

/**
 * 게스트 토큰 발급/검증 서비스. 순수 함수(guest-token.ts)에 비밀키만 주입해 감싼다.
 *
 * 비밀키는 JWT_SECRET 에서 파생한다(guest-token.ts 참고). env 검증이 JWT_SECRET 을
 * 필수로 강제하므로 여기서 미설정을 따로 처리할 필요가 없다.
 */
@Injectable()
export class GuestTokenService {
  /** 발급 토큰의 고정 길이. DTO/DB 제약을 맞출 때 참고한다. */
  static readonly LENGTH = GUEST_TOKEN_LENGTH;

  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  /** 새 게스트 토큰 발급. */
  issue(): string {
    return issueGuestToken(this.secret);
  }

  /** 서버가 발급한 토큰인지 검증. */
  verify(token: string): boolean {
    return verifyGuestToken(token, this.secret);
  }
}
