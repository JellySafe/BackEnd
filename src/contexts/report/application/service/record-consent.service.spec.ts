import { ConfigService } from '@nestjs/config';
import { ValidationError } from '@shared/kernel/domain-error';
import { RecordConsentService } from './record-consent.service';
import {
  ConsentRecord,
  ConsentRepositoryPort,
} from '../port/out/consent-repository.port';

/**
 * PRIV-001 동의 기록.
 *
 * 이 유스케이스가 없던 동안 제보 접수는 사실상 호출 불가능했다(필수인 consentLogIds 를 만들 곳이
 * 없었다). 그래서 "무엇을 기록하고 무엇을 거부하는가" 를 테스트로 못 박아 둔다.
 */
describe('RecordConsentService', () => {
  const owner = { userId: null, userToken: 'gAAAA' };
  const all = [
    { type: 'privacy' as const, agreed: true },
    { type: 'location' as const, agreed: true },
    { type: 'image' as const, agreed: true },
  ];

  let saved: ConsentRecord[];
  let repository: ConsentRepositoryPort;

  function build(retentionDays = '365'): RecordConsentService {
    return new RecordConsentService(
      repository,
      new ConfigService({ CONSENT_RETENTION_DAYS: retentionDays }),
    );
  }

  beforeEach(() => {
    saved = [];
    repository = {
      saveAll: (records: ConsentRecord[]) => {
        saved = records;
        return Promise.resolve(
          records.map((r, i) => ({ consentLogId: i + 1, type: r.type, agreed: r.agreed })),
        );
      },
      purgeExpired: jest.fn().mockResolvedValue(0),
    };
  });

  it('필수 동의를 모두 받으면 제보에 넣을 id 를 돌려준다', async () => {
    const result = await build().record({
      owner,
      decisions: all,
      policyVersion: 'v1',
      ipAddress: '203.0.113.7',
    });

    expect(result.consentLogIds).toEqual([1, 2, 3]);
    expect(saved).toHaveLength(3);
  });

  it('소유자·고지 버전·IP 를 그대로 기록한다 (나중에 되짚을 단서다)', async () => {
    await build().record({
      owner,
      decisions: all,
      policyVersion: 'v2',
      ipAddress: '203.0.113.7',
    });

    expect(saved[0].owner).toEqual(owner);
    expect(saved[0].policyVersion).toBe('v2');
    expect(saved[0].ipAddress).toBe('203.0.113.7');
  });

  it('선택 항목의 거부도 기록한다 — 물어봤다는 사실이 근거다', async () => {
    await build().record({
      owner,
      decisions: [...all, { type: 'marketing', agreed: false }],
      policyVersion: 'v1',
      ipAddress: null,
    });

    const marketing = saved.find((r) => r.type === 'marketing');
    expect(marketing?.agreed).toBe(false);
  });

  it('필수 항목이 빠지면 기록하지 않고 거부한다', async () => {
    await expect(
      build().record({
        owner,
        decisions: [{ type: 'privacy', agreed: true }],
        policyVersion: 'v1',
        ipAddress: null,
      }),
    ).rejects.toThrow(ValidationError);
    expect(saved).toHaveLength(0);
  });

  it('필수 항목을 거부하면 그 자리에서 막는다 (다음 화면에서 막히지 않게)', async () => {
    await expect(
      build().record({
        owner,
        decisions: [...all.slice(0, 2), { type: 'image', agreed: false }],
        policyVersion: 'v1',
        ipAddress: null,
      }),
    ).rejects.toThrow(ValidationError);
    expect(saved).toHaveLength(0);
  });

  it('같은 항목을 두 번 보내면 마지막 값 하나만 기록한다', async () => {
    await build().record({
      owner,
      decisions: [{ type: 'privacy', agreed: false }, ...all],
      policyVersion: 'v1',
      ipAddress: null,
    });

    expect(saved.filter((r) => r.type === 'privacy')).toHaveLength(1);
    expect(saved.find((r) => r.type === 'privacy')?.agreed).toBe(true);
  });

  it('만료 시각은 동의 시점 + 보관 일수다', async () => {
    const result = await build('30').record({
      owner,
      decisions: all,
      policyVersion: 'v1',
      ipAddress: null,
    });

    const days = (result.expiresAt.getTime() - saved[0].agreedAt.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(30, 5);
  });

  it('같은 요청의 동의는 같은 시각·같은 만료를 갖는다 (한 화면에서 받은 한 벌이다)', async () => {
    await build().record({ owner, decisions: all, policyVersion: 'v1', ipAddress: null });

    const times = new Set(saved.map((r) => r.agreedAt.getTime()));
    const expiries = new Set(saved.map((r) => r.expiresAt.getTime()));
    expect(times.size).toBe(1);
    expect(expiries.size).toBe(1);
  });
});
