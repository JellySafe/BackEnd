import { Inject, Injectable, Logger } from '@nestjs/common';
import { ValidationError } from '@shared/kernel/domain-error';
import { maskEndpoint, parseWebPushSubscription } from '../../domain/push-subscription';
import {
  RegisterPushSubscriptionCommand,
  RegisterPushSubscriptionResult,
  RegisterPushSubscriptionUseCase,
} from '../port/in/notification-use-cases';
import {
  PushConsentRepositoryPort,
  PUSH_CONSENT_REPOSITORY,
} from '../port/out/push-consent-repository.port';

/**
 * 브라우저 푸시 구독 등록 (수신 동의).
 *
 * 비로그인 사용자는 userToken(관심 해변 등록에 쓰는 것과 같은 게스트 토큰)으로,
 * 로그인 사용자는 userId 로 식별한다. 이메일/전화번호가 없는 서비스라 이게 유일한 수신자 키다.
 *
 * 같은 endpoint 재등록은 멱등이다(created=false). 브라우저는 앱을 열 때마다 구독을 다시
 * 보내는 게 정상 패턴이라(구독 만료 대비) 호출될 때마다 행이 늘면 안 된다.
 */
@Injectable()
export class RegisterPushSubscriptionService implements RegisterPushSubscriptionUseCase {
  private readonly logger = new Logger(RegisterPushSubscriptionService.name);

  constructor(
    @Inject(PUSH_CONSENT_REPOSITORY) private readonly consents: PushConsentRepositoryPort,
  ) {}

  async register(
    command: RegisterPushSubscriptionCommand,
  ): Promise<RegisterPushSubscriptionResult> {
    const { owner } = command;
    if (owner.userId === null && (owner.userToken === null || owner.userToken === '')) {
      throw new ValidationError(
        'PUSH_OWNER_REQUIRED',
        '푸시 구독 소유자가 필요합니다(userToken 또는 userId).',
      );
    }

    // 브라우저가 준 값이라도 그대로 믿지 않는다. 깨진 구독을 저장하면 발송 때 매번 실패한다.
    const subscription = parseWebPushSubscription(command.subscription);
    const now = command.now ?? new Date();

    const result = await this.consents.upsert({ owner, subscription, now });

    this.logger.log(
      `푸시 구독 ${result.created ? '등록' : '갱신'} ` +
        `(consentId=${result.consentId}, recipient=${maskEndpoint(subscription.endpoint)})`,
    );
    return result;
  }
}
