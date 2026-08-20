import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@shared/kernel/domain-error';
import { Id } from '@shared/kernel/id';
import {
  apiKeyMatches,
  apiKeyPrefixOf,
  evaluateApiKey,
  hasScope,
  issueApiKey,
  PartnerScope,
} from '../../domain/partner-api-key';
import {
  ApiKeySummary,
  AuthenticatedPartner,
  AuthenticatePartnerUseCase,
  IssueApiKeyCommand,
  IssueApiKeyResult,
  IssueApiKeyUseCase,
  ManageApiKeyUseCase,
  RecordPartnerCallUseCase,
} from '../port/in/partner-use-cases';
import {
  PartnerApiKeyRepositoryPort,
  PARTNER_API_KEY_REPOSITORY,
  RecordCallInput,
} from '../port/out/partner-api-key-repository.port';

/** 분당 호출 상한 기본값. 위험도는 30분마다 갱신되므로 이보다 자주 부를 이유가 없다. */
const DEFAULT_RATE_LIMIT_PER_MIN = 60;

/** 실패는 이유를 가리지 않는다 — 아래 주석 참고. */
const INVALID = () =>
  new DomainError('UNAUTHORIZED', 'PARTNER_API_KEY_INVALID', '유효하지 않은 API 키입니다.');

/**
 * 제휴사 API 키 발급·폐기·검증 (EX-001).
 *
 * ── 발급 응답에서만 원문을 보여준다 ──────────────────────────────────────────────────
 * 서버는 해시만 저장한다. 그래서 "키를 다시 알려달라" 는 요청에는 답할 수 없고, 잃어버리면
 * 새로 발급하고 기존 키를 폐기하는 것이 유일한 방법이다. 불편하지만, DB 덤프 하나로 제휴사
 * 전부의 자격증명이 새는 것보다 낫다.
 *
 * ── 실패 이유를 나눠 알려주지 않는다 ─────────────────────────────────────────────────
 * 위조·폐기·만료·계약 종료를 모두 401 `PARTNER_API_KEY_INVALID` 로 응답한다. 이유를 나누면
 * 키를 주워 온 쪽이 "존재는 하는 키" 임을 알게 된다. 서버 로그에는 상태가 남는다.
 * (스코프 부족만 403 으로 구분한다 — 키는 유효하고 권한 범위의 문제라, 제휴사가 계약을
 *  확인해 해결할 수 있는 정보다)
 */
@Injectable()
export class PartnerApiKeyService
  implements IssueApiKeyUseCase, ManageApiKeyUseCase, AuthenticatePartnerUseCase, RecordPartnerCallUseCase
{
  private readonly logger = new Logger(PartnerApiKeyService.name);

  constructor(
    @Inject(PARTNER_API_KEY_REPOSITORY)
    private readonly repository: PartnerApiKeyRepositoryPort,
  ) {}

  async issue(command: IssueApiKeyCommand): Promise<IssueApiKeyResult> {
    if (command.scopes.length === 0) {
      throw new DomainError(
        'VALIDATION',
        'PARTNER_SCOPE_REQUIRED',
        '키가 쓸 수 있는 범위(scopes)를 하나 이상 지정해야 합니다.',
      );
    }

    const issued = issueApiKey();
    const rateLimitPerMin = command.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    const saved = await this.repository.save({
      partnerId: command.partnerId,
      keyPrefix: issued.keyPrefix,
      apiKeyHash: issued.apiKeyHash,
      scopes: command.scopes,
      rateLimitPerMin,
      expiresAt: command.expiresAt ?? null,
    });

    this.logger.log(
      `제휴사 ${command.partnerId} API 키 발급 (${issued.keyPrefix}, 범위=${command.scopes.join(',')})`,
    );
    return {
      apiKeyId: saved.apiKeyId,
      keyPrefix: saved.keyPrefix,
      apiKey: issued.apiKey,
      scopes: saved.scopes,
      rateLimitPerMin: saved.rateLimitPerMin,
      expiresAt: saved.expiresAt,
    };
  }

  list(partnerId: Id): Promise<ApiKeySummary[]> {
    return this.repository.listByPartner(partnerId);
  }

  async revoke(apiKeyId: Id): Promise<{ revoked: boolean }> {
    const revoked = await this.repository.revoke(apiKeyId, new Date());
    if (revoked) this.logger.log(`제휴사 API 키 폐기 (id=${apiKeyId})`);
    // 이미 폐기된 키를 다시 폐기해도 오류가 아니다(멱등) — 목적은 이미 달성돼 있다.
    return { revoked };
  }

  async authenticate(apiKey: string, requiredScope: PartnerScope): Promise<AuthenticatedPartner> {
    const prefix = apiKeyPrefixOf(apiKey.trim());
    // 형식이 아니면 DB 를 조회할 필요조차 없다.
    if (prefix === null) throw INVALID();

    const stored = await this.repository.findByPrefix(prefix);
    if (stored === null || !apiKeyMatches(apiKey.trim(), stored.apiKeyHash)) throw INVALID();

    const state = evaluateApiKey(stored, new Date());
    if (state !== 'valid') {
      this.logger.warn(`제휴 API 키 거부 (${prefix}, 상태=${state})`);
      throw INVALID();
    }

    if (!hasScope(stored, requiredScope)) {
      // 키는 유효하다. 범위의 문제이므로 403 으로 구분해 알려준다.
      throw new DomainError(
        'FORBIDDEN',
        'PARTNER_SCOPE_FORBIDDEN',
        '이 API 키에는 해당 기능의 사용 권한이 없습니다.',
        { required: requiredScope, granted: stored.scopes },
      );
    }

    return {
      partnerId: stored.partnerId,
      apiKeyId: stored.apiKeyId,
      keyPrefix: stored.keyPrefix,
      scopes: stored.scopes,
      rateLimitPerMin: stored.rateLimitPerMin,
    };
  }

  record(input: RecordCallInput): Promise<void> {
    return this.repository.recordCall(input);
  }
}
