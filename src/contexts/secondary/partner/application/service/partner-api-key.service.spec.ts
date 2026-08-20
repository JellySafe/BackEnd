import { DomainError } from '@shared/kernel/domain-error';
import { PartnerApiKeyService } from './partner-api-key.service';
import {
  ApiKeySummary,
  PartnerApiKeyRepositoryPort,
  RecordCallInput,
  SaveApiKeyInput,
} from '../port/out/partner-api-key-repository.port';
import { hashApiKey, StoredApiKey } from '../../domain/partner-api-key';

/**
 * 제휴사 API 키 (EX-001).
 *
 * 이 키는 **우리 데이터에 접근하는 자격증명**이다. 그래서 "무엇을 받아들이지 않는가" 를
 * 테스트로 못 박는다 — 폐기·만료·계약 종료·범위 부족·위조.
 */
describe('PartnerApiKeyService', () => {
  let saved: SaveApiKeyInput[];
  let stored: StoredApiKey | null;
  let calls: RecordCallInput[];
  let repository: PartnerApiKeyRepositoryPort;
  let service: PartnerApiKeyService;

  function summaryOf(input: SaveApiKeyInput): ApiKeySummary {
    return {
      apiKeyId: 1,
      partnerId: input.partnerId,
      keyPrefix: input.keyPrefix,
      scopes: input.scopes,
      rateLimitPerMin: input.rateLimitPerMin,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    };
  }

  beforeEach(() => {
    saved = [];
    stored = null;
    calls = [];
    repository = {
      save: (input) => {
        saved.push(input);
        return Promise.resolve(summaryOf(input));
      },
      findByPrefix: () => Promise.resolve(stored),
      listByPartner: () => Promise.resolve([]),
      revoke: jest.fn().mockResolvedValue(true),
      recordCall: (input) => {
        calls.push(input);
        return Promise.resolve();
      },
    };
    service = new PartnerApiKeyService(repository);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  /** 발급된 키를 저장소에 있는 것처럼 만든다. */
  async function issueAndStore(overrides: Partial<StoredApiKey> = {}): Promise<string> {
    const result = await service.issue({ partnerId: 7, scopes: ['risk:read'] });
    stored = {
      apiKeyId: result.apiKeyId,
      partnerId: 7,
      keyPrefix: result.keyPrefix,
      apiKeyHash: hashApiKey(result.apiKey),
      scopes: result.scopes,
      rateLimitPerMin: result.rateLimitPerMin,
      expiresAt: null,
      revokedAt: null,
      partnerStatus: 'active',
      ...overrides,
    };
    return result.apiKey;
  }

  describe('발급', () => {
    it('원문은 응답에만, 저장소에는 해시만 간다', async () => {
      const result = await service.issue({ partnerId: 7, scopes: ['risk:read'] });

      expect(result.apiKey.startsWith(result.keyPrefix)).toBe(true);
      expect(saved[0].apiKeyHash).toBe(hashApiKey(result.apiKey));
      expect(JSON.stringify(saved[0])).not.toContain(result.apiKey.split('_')[2]);
    });

    it('분당 한도 기본값을 적용한다 (위험도는 30분마다 갱신된다)', async () => {
      const result = await service.issue({ partnerId: 7, scopes: ['risk:read'] });
      expect(result.rateLimitPerMin).toBe(60);
    });

    it('범위를 지정하지 않으면 발급하지 않는다 — 아무것도 못 하는 키는 만들 이유가 없다', async () => {
      await expect(service.issue({ partnerId: 7, scopes: [] })).rejects.toMatchObject({
        code: 'PARTNER_SCOPE_REQUIRED',
      });
      expect(saved).toHaveLength(0);
    });
  });

  describe('검증', () => {
    it('유효한 키는 제휴사 신원을 돌려준다', async () => {
      const apiKey = await issueAndStore();

      const partner = await service.authenticate(apiKey, 'risk:read');

      expect(partner.partnerId).toBe(7);
      expect(partner.scopes).toEqual(['risk:read']);
    });

    it('형식이 아닌 값은 조회조차 하지 않는다', async () => {
      const findByPrefix = jest.spyOn(repository, 'findByPrefix');

      await expect(service.authenticate('not-a-key', 'risk:read')).rejects.toThrow(DomainError);
      expect(findByPrefix).not.toHaveBeenCalled();
    });

    it('해시가 다르면 거부한다 (접두사만 맞춘 위조)', async () => {
      const apiKey = await issueAndStore();
      const forged = `${apiKey.slice(0, apiKey.length - 1)}X`;

      await expect(service.authenticate(forged, 'risk:read')).rejects.toThrow(DomainError);
    });

    it('폐기·만료·계약종료는 모두 같은 코드로 거부한다 — 존재 여부를 알려주지 않는다', async () => {
      const codes: string[] = [];
      for (const overrides of [
        { revokedAt: new Date() },
        { expiresAt: new Date(Date.now() - 1000) },
        { partnerStatus: 'terminated' },
      ]) {
        const apiKey = await issueAndStore(overrides);
        const code = await service
          .authenticate(apiKey, 'risk:read')
          .catch((e: DomainError) => e.code);
        codes.push(code as unknown as string);
      }

      expect(codes).toEqual([
        'PARTNER_API_KEY_INVALID',
        'PARTNER_API_KEY_INVALID',
        'PARTNER_API_KEY_INVALID',
      ]);
    });

    it('범위가 없으면 403 — 키는 유효하므로 401 과 구분해 알려준다', async () => {
      const apiKey = await issueAndStore({ scopes: ['risk:read'] });

      await expect(service.authenticate(apiKey, 'beach:read')).rejects.toMatchObject({
        kind: 'FORBIDDEN',
        code: 'PARTNER_SCOPE_FORBIDDEN',
      });
    });
  });

  describe('폐기', () => {
    it('폐기하면 true', async () => {
      await expect(service.revoke(3)).resolves.toEqual({ revoked: true });
    });

    it('이미 폐기된 키를 또 폐기해도 오류가 아니다', async () => {
      (repository.revoke as jest.Mock).mockResolvedValue(false);
      await expect(service.revoke(3)).resolves.toEqual({ revoked: false });
    });
  });

  describe('호출 기록', () => {
    it('그대로 저장소에 넘긴다', async () => {
      await service.record({
        partnerId: 7,
        apiKeyId: 1,
        endpoint: '/api/partner/v1/beaches',
        httpMethod: 'GET',
        statusCode: 200,
        responseTimeMs: 12,
        isBillable: true,
        calledAt: new Date(),
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].endpoint).toBe('/api/partner/v1/beaches');
    });
  });
});
