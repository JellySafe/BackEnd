import { Inject, Injectable, Logger } from '@nestjs/common';
import { ValidationError } from '@shared/kernel/domain-error';
import {
  RevokePushSubscriptionCommand,
  RevokePushSubscriptionResult,
  RevokePushSubscriptionUseCase,
} from '../port/in/notification-use-cases';
import {
  PushConsentRepositoryPort,
  PUSH_CONSENT_REPOSITORY,
} from '../port/out/push-consent-repository.port';

/**
 * 브라우저 푸시 구독 해제 (수신 거부).
 *
 * revoked_at 을 찍고 agreed=false 로 내린다. 행을 지우지 않는 이유는 동의/철회 이력이
 * 남아야 하기 때문이다(수신 동의는 개인정보 처리 근거다).
 *
 * endpoint 를 주면 그 기기만, 안 주면 이 사용자의 푸시 구독 전부를 해제한다.
 * 해제할 게 없어도 에러가 아니다(멱등) — 사용자가 이미 브라우저에서 껐을 수 있다.
 */
@Injectable()
export class RevokePushSubscriptionService implements RevokePushSubscriptionUseCase {
  private readonly logger = new Logger(RevokePushSubscriptionService.name);

  constructor(
    @Inject(PUSH_CONSENT_REPOSITORY) private readonly consents: PushConsentRepositoryPort,
  ) {}

  async revoke(command: RevokePushSubscriptionCommand): Promise<RevokePushSubscriptionResult> {
    const { owner } = command;
    if (owner.userId === null && (owner.userToken === null || owner.userToken === '')) {
      throw new ValidationError(
        'PUSH_OWNER_REQUIRED',
        '푸시 구독 소유자가 필요합니다(token 또는 userId).',
      );
    }

    const now = command.now ?? new Date();
    const endpoint = command.endpoint?.trim() ? command.endpoint.trim() : null;

    const revokedCount = await this.consents.revoke({ owner, endpoint, now });

    this.logger.log(
      `푸시 구독 해제 (${revokedCount}건, 범위=${endpoint === null ? '전체' : '지정 기기'})`,
    );
    return { revokedCount };
  }
}
