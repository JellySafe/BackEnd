import { Inject, Injectable } from '@nestjs/common';
import {
  GetPushPublicKeyUseCase,
  PushPublicKeyResult,
} from '../port/in/notification-use-cases';
import { PushSenderPort, PUSH_SENDER } from '../port/out/push-sender.port';

/**
 * 브라우저가 구독할 때 필요한 VAPID 공개키를 내려준다.
 *
 * 프론트는 `pushManager.subscribe({ applicationServerKey })` 에 이 값을 넣어야 하는데,
 * 공개키를 번들에 하드코딩하면 키를 회전할 때마다 재배포해야 한다. 서버가 내려주면
 * 키 교체가 백엔드 환경변수만으로 끝난다.
 *
 * 공개키는 이름 그대로 공개해도 되는 값이다(비밀키만 서버에 남는다).
 * configured=false 면 프론트는 구독 UI 를 감춰야 한다 — 구독해 봐야 발송되지 않는다.
 */
@Injectable()
export class GetPushPublicKeyService implements GetPushPublicKeyUseCase {
  constructor(@Inject(PUSH_SENDER) private readonly sender: PushSenderPort) {}

  getPublicKey(): PushPublicKeyResult {
    return {
      publicKey: this.sender.getPublicKey(),
      configured: this.sender.isConfigured(),
    };
  }
}
