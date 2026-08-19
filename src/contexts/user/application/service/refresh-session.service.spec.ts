import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '@shared/kernel/domain-error';
import { RefreshSessionService } from './refresh-session.service';
import { LogoutService } from './logout.service';
import { UserRepositoryPort } from '../port/out/user-repository.port';
import { RefreshTokenRepositoryPort } from '../port/out/refresh-token-repository.port';
import {
  hashRefreshToken,
  IssuedRefreshToken,
  issueRefreshToken,
  RevokeReason,
  StoredRefreshToken,
} from '../../domain/refresh-token';
import { User } from '../../domain/user';

/**
 * 재발급/로그아웃 유스케이스 테스트.
 *
 * 저장소는 메모리 가짜다. 검증 대상이 "SQL 이 맞는가" 가 아니라 **"어떤 토큰을 받아들이고,
 * 사고 신호에 어떻게 반응하는가"** 라서다. 특히 재사용 감지는 실제로 사고가 났을 때만 도는
 * 경로라, 테스트가 없으면 아무도 그것이 동작하는지 모른 채 지나간다.
 */

/** 저장된 행 + 회전 사슬을 흉내 내는 메모리 저장소. */
class FakeRefreshTokenRepository implements RefreshTokenRepositoryPort {
  rows: (StoredRefreshToken & { tokenHash: string; revokedReason: RevokeReason | null })[] = [];
  private nextId = 1;

  save(userId: number, issued: IssuedRefreshToken): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      userId,
      tokenHash: issued.tokenHash,
      familyId: issued.familyId,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      usedAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    return Promise.resolve();
  }

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    return Promise.resolve(this.rows.find((r) => r.tokenHash === tokenHash) ?? null);
  }

  markUsed(id: number, at: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.usedAt = at;
    return Promise.resolve();
  }

  revokeFamily(familyId: string, at: Date, reason: RevokeReason): Promise<number> {
    return Promise.resolve(this.revoke((r) => r.familyId === familyId, at, reason));
  }

  revokeAllForUser(userId: number, at: Date, reason: RevokeReason): Promise<number> {
    return Promise.resolve(this.revoke((r) => r.userId === userId, at, reason));
  }

  purgeExpiredBefore(cutoff: Date, batchSize: number): Promise<number> {
    const doomed = this.rows.filter((r) => r.expiresAt < cutoff).slice(0, batchSize);
    this.rows = this.rows.filter((r) => !doomed.includes(r));
    return Promise.resolve(doomed.length);
  }

  private revoke(
    match: (r: StoredRefreshToken) => boolean,
    at: Date,
    reason: RevokeReason,
  ): number {
    let count = 0;
    for (const row of this.rows) {
      if (match(row) && row.revokedAt === null) {
        row.revokedAt = at;
        row.revokedReason = reason;
        count++;
      }
    }
    return count;
  }
}

function userWith(isActive: boolean, id = 7): User {
  return User.reconstitute({
    id,
    role: 'admin',
    email: 'admin@jellysafe.local',
    passwordHash: 'salt:hash',
    name: '관리자',
    organization: null,
    managedRegion: null,
    isActive,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

const activeUser = (id = 7): User => userWith(true, id);
const inactiveUser = (id = 7): User => userWith(false, id);

describe('RefreshSessionService', () => {
  let repo: FakeRefreshTokenRepository;
  let users: jest.Mocked<Pick<UserRepositoryPort, 'findById'>>;
  let service: RefreshSessionService;
  let logout: LogoutService;

  const jwt = new JwtService({ secret: 'test-secret-0123456789abcdef0123456789abcdef' });
  const config = new ConfigService({ REFRESH_TOKEN_EXPIRES_DAYS: '14' });

  /** 로그인 한 번을 흉내 내 살아있는 토큰 하나를 만든다. */
  async function loginOnce(userId = 7): Promise<IssuedRefreshToken> {
    const issued = issueRefreshToken(new Date(), 14);
    await repo.save(userId, issued);
    return issued;
  }

  beforeEach(() => {
    repo = new FakeRefreshTokenRepository();
    users = { findById: jest.fn().mockResolvedValue(activeUser()) };
    service = new RefreshSessionService(
      users as unknown as UserRepositoryPort,
      repo,
      jwt,
      config,
    );
    logout = new LogoutService(repo);
  });

  it('살아있는 토큰이면 새 accessToken 과 새 refreshToken 을 준다', async () => {
    const issued = await loginOnce();

    const result = await service.refresh({ refreshToken: issued.token });

    expect(result.userId).toBe(7);
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).not.toBe(issued.token);
    expect(result.refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('회전된 이전 토큰은 곧바로 쓸 수 없다 — 이것이 회전의 요점이다', async () => {
    const issued = await loginOnce();
    await service.refresh({ refreshToken: issued.token });

    await expect(service.refresh({ refreshToken: issued.token })).rejects.toThrow(DomainError);
  });

  it('회전은 사슬(family)을 이어받는다', async () => {
    const issued = await loginOnce();
    const result = await service.refresh({ refreshToken: issued.token });

    const rotated = await repo.findByHash(hashRefreshToken(result.refreshToken));
    expect(rotated?.familyId).toBe(issued.familyId);
  });

  it('이미 쓴 토큰이 다시 오면 사슬 전체를 무효화한다 (도난 대응)', async () => {
    const first = await loginOnce();
    const second = await service.refresh({ refreshToken: first.token });

    // 훔친 쪽이 예전 토큰으로 재발급을 시도한다.
    await expect(service.refresh({ refreshToken: first.token })).rejects.toThrow(DomainError);

    // 원래 사용자의 최신 토큰까지 함께 끊긴다 — 누가 진짜인지 서버는 알 수 없다.
    await expect(service.refresh({ refreshToken: second.refreshToken })).rejects.toThrow(
      DomainError,
    );
    expect(repo.rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(repo.rows.some((r) => r.revokedReason === 'reuse_detected')).toBe(true);
  });

  it('만료된 토큰은 거부한다', async () => {
    const expired = issueRefreshToken(new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), 14);
    await repo.save(7, expired);

    await expect(service.refresh({ refreshToken: expired.token })).rejects.toThrow(DomainError);
  });

  it('로그아웃으로 무효화된 토큰은 거부한다', async () => {
    const issued = await loginOnce();
    await logout.logout({ refreshToken: issued.token });

    await expect(service.refresh({ refreshToken: issued.token })).rejects.toThrow(DomainError);
  });

  it('저장소에 없는 값(위조·이미 정리됨)은 거부한다', async () => {
    const stranger = issueRefreshToken(new Date(), 14);
    await expect(service.refresh({ refreshToken: stranger.token })).rejects.toThrow(DomainError);
  });

  it('형식이 아닌 값은 DB 조회 없이 거부한다', async () => {
    const findByHash = jest.spyOn(repo, 'findByHash');
    await expect(service.refresh({ refreshToken: 'not-a-token' })).rejects.toThrow(DomainError);
    expect(findByHash).not.toHaveBeenCalled();
  });

  it('실패 이유를 가리지 않고 같은 코드로 응답한다 — 토큰 존재 여부를 알려주지 않는다', async () => {
    const issued = await loginOnce();
    await logout.logout({ refreshToken: issued.token });
    const stranger = issueRefreshToken(new Date(), 14);

    const codes = await Promise.all(
      [issued.token, stranger.token, 'not-a-token'].map((token) =>
        service.refresh({ refreshToken: token }).catch((e: DomainError) => e.code),
      ),
    );
    expect(codes).toEqual([
      'REFRESH_TOKEN_INVALID',
      'REFRESH_TOKEN_INVALID',
      'REFRESH_TOKEN_INVALID',
    ]);
  });

  it('토큰이 살아 있어도 계정이 정지됐으면 거부하고 그 계정의 토큰을 모두 끊는다', async () => {
    const issued = await loginOnce();
    users.findById.mockResolvedValue(inactiveUser());

    await expect(service.refresh({ refreshToken: issued.token })).rejects.toThrow(DomainError);
    expect(repo.rows.every((r) => r.revokedAt !== null)).toBe(true);
  });
});

describe('LogoutService', () => {
  let repo: FakeRefreshTokenRepository;
  let service: LogoutService;

  beforeEach(() => {
    repo = new FakeRefreshTokenRepository();
    service = new LogoutService(repo);
  });

  it('그 기기의 사슬만 무효화한다 (다른 기기 로그인은 살아 있다)', async () => {
    const phone = issueRefreshToken(new Date(), 14);
    const laptop = issueRefreshToken(new Date(), 14);
    await repo.save(7, phone);
    await repo.save(7, laptop);

    const result = await service.logout({ refreshToken: phone.token });

    expect(result.revokedCount).toBe(1);
    expect((await repo.findByHash(hashRefreshToken(laptop.token)))?.revokedAt).toBeNull();
  });

  it('allDevices 면 그 계정의 모든 토큰을 끊는다 (기기 분실 대응)', async () => {
    const phone = issueRefreshToken(new Date(), 14);
    const laptop = issueRefreshToken(new Date(), 14);
    await repo.save(7, phone);
    await repo.save(7, laptop);

    const result = await service.logout({ refreshToken: phone.token, allDevices: true });

    expect(result.revokedCount).toBe(2);
    expect(repo.rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  it('다른 사용자의 토큰은 건드리지 않는다', async () => {
    const mine = issueRefreshToken(new Date(), 14);
    const others = issueRefreshToken(new Date(), 14);
    await repo.save(7, mine);
    await repo.save(9, others);

    await service.logout({ refreshToken: mine.token, allDevices: true });

    expect((await repo.findByHash(hashRefreshToken(others.token)))?.revokedAt).toBeNull();
  });

  it('없는 토큰·형식이 틀린 값도 성공으로 응답한다 (토큰 존재 여부를 알려주지 않는다)', async () => {
    const stranger = issueRefreshToken(new Date(), 14);

    await expect(service.logout({ refreshToken: stranger.token })).resolves.toEqual({
      revokedCount: 0,
    });
    await expect(service.logout({ refreshToken: 'nope' })).resolves.toEqual({ revokedCount: 0 });
  });

  it('두 번 눌러도 오류가 아니다 (두 번째는 0건)', async () => {
    const issued = issueRefreshToken(new Date(), 14);
    await repo.save(7, issued);

    expect((await service.logout({ refreshToken: issued.token })).revokedCount).toBe(1);
    expect((await service.logout({ refreshToken: issued.token })).revokedCount).toBe(0);
  });
});
