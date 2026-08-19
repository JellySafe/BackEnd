import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DomainError } from '@shared/kernel/domain-error';
import { LoginUserService } from './login-user.service';
import { UserRepositoryPort } from '../port/out/user-repository.port';
import {
  RefreshTokenRepositoryPort,
  RefreshTokenStorageUnavailableError,
} from '../port/out/refresh-token-repository.port';
import { isRefreshTokenFormat, IssuedRefreshToken } from '../../domain/refresh-token';
import { User } from '../../domain/user';
import { hashPassword } from '../../domain/password';

/**
 * 로그인 유스케이스 — 리프레시 토큰 발급이 붙은 뒤의 계약을 고정한다.
 *
 * 특히 **저장소가 없을 때도 로그인은 된다**를 테스트로 못 박는다. DB-first 라 코드가 먼저
 * 배포되고 DDL 은 나중에 적용되는 창이 실제로 존재하고, 그 창에서 로그인이 죽으면 관리자
 * 콘솔 전체가 멎기 때문이다.
 */

const PASSWORD = 'test1234';

function user(isActive = true): User {
  return User.reconstitute({
    id: 7,
    role: 'admin',
    email: 'admin@jellysafe.local',
    passwordHash: hashPassword(PASSWORD),
    name: '관리자',
    organization: null,
    managedRegion: null,
    isActive,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('LoginUserService', () => {
  const jwt = new JwtService({ secret: 'test-secret-0123456789abcdef0123456789abcdef' });
  const config = new ConfigService({ REFRESH_TOKEN_EXPIRES_DAYS: '14' });

  let users: jest.Mocked<Pick<UserRepositoryPort, 'findByEmail' | 'updateLastLogin'>>;
  let saved: { userId: number; issued: IssuedRefreshToken }[];
  let refreshTokens: RefreshTokenRepositoryPort;
  let service: LoginUserService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn().mockResolvedValue(user()),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    saved = [];
    refreshTokens = {
      save: (userId: number, issued: IssuedRefreshToken) => {
        saved.push({ userId, issued });
        return Promise.resolve();
      },
      findByHash: () => Promise.resolve(null),
      markUsed: () => Promise.resolve(),
      revokeFamily: () => Promise.resolve(0),
      revokeAllForUser: () => Promise.resolve(0),
      purgeExpiredBefore: () => Promise.resolve(0),
    };
    service = new LoginUserService(
      users as unknown as UserRepositoryPort,
      refreshTokens,
      jwt,
      config,
    );
  });

  it('accessToken 과 refreshToken 을 함께 발급한다', async () => {
    const result = await service.login({ email: 'admin@jellysafe.local', password: PASSWORD });

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).not.toBeNull();
    expect(isRefreshTokenFormat(result.refreshToken!)).toBe(true);
    expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('저장되는 것은 해시뿐이다 — 원문은 DB 로 가지 않는다', async () => {
    const result = await service.login({ email: 'admin@jellysafe.local', password: PASSWORD });

    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe(7);
    expect(saved[0].issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved[0].issued)).toContain(saved[0].issued.tokenHash);
    // 저장 객체에 원문이 들어 있더라도(어댑터가 해시만 쓴다) 응답 토큰과 해시는 다른 값이다.
    expect(saved[0].issued.tokenHash).not.toBe(result.refreshToken);
  });

  it('이메일을 소문자로 정규화해 조회한다', async () => {
    await service.login({ email: '  Admin@JellySafe.local ', password: PASSWORD });
    expect(users.findByEmail).toHaveBeenCalledWith('admin@jellysafe.local');
  });

  it('저장소(테이블)가 없으면 refreshToken 만 null 이고 로그인은 성공한다', async () => {
    refreshTokens.save = () => Promise.reject(new RefreshTokenStorageUnavailableError());
    service = new LoginUserService(
      users as unknown as UserRepositoryPort,
      refreshTokens,
      jwt,
      config,
    );

    const result = await service.login({ email: 'admin@jellysafe.local', password: PASSWORD });

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).toBeNull();
    expect(result.refreshTokenExpiresAt).toBeNull();
  });

  it('저장소가 다른 이유로 실패하면 감추지 않는다 (DB 장애를 성공으로 위장하지 않는다)', async () => {
    refreshTokens.save = () => Promise.reject(new Error('DB 연결 끊김'));
    service = new LoginUserService(
      users as unknown as UserRepositoryPort,
      refreshTokens,
      jwt,
      config,
    );

    await expect(
      service.login({ email: 'admin@jellysafe.local', password: PASSWORD }),
    ).rejects.toThrow('DB 연결 끊김');
  });

  it('비밀번호가 틀리면 토큰을 발급하지 않는다', async () => {
    await expect(
      service.login({ email: 'admin@jellysafe.local', password: 'wrong-password' }),
    ).rejects.toThrow(DomainError);
    expect(saved).toHaveLength(0);
  });

  it('비활성 계정은 로그인할 수 없다', async () => {
    users.findByEmail.mockResolvedValue(user(false));

    await expect(
      service.login({ email: 'admin@jellysafe.local', password: PASSWORD }),
    ).rejects.toThrow(DomainError);
    expect(saved).toHaveLength(0);
  });

  it('없는 계정과 틀린 비밀번호는 같은 코드로 응답한다 (계정 존재 여부를 알려주지 않는다)', async () => {
    users.findByEmail.mockResolvedValue(null);
    const missing = await service
      .login({ email: 'nobody@jellysafe.local', password: PASSWORD })
      .catch((e: DomainError) => e.code);

    users.findByEmail.mockResolvedValue(user());
    const wrong = await service
      .login({ email: 'admin@jellysafe.local', password: 'wrong-password' })
      .catch((e: DomainError) => e.code);

    expect(missing).toBe('AUTH_INVALID_CREDENTIALS');
    expect(wrong).toBe('AUTH_INVALID_CREDENTIALS');
  });
});
