import { ConfigService } from '@nestjs/config';
import { DomainError } from '@shared/kernel/domain-error';
import { SecondaryEnabledGuard } from './secondary-enabled.guard';

/**
 * 2차 기능 전체 스위치.
 *
 * 지키려는 것: **안 쓰는 기능은 닫아 둘 수 있어야 한다.** 특히 `/partner/v1/*` 은 별도
 * 자격증명으로 들어오는 문이라, 제휴사가 없는 환경에서 열어 둘 이유가 없다.
 */
describe('SecondaryEnabledGuard', () => {
  function guardWith(value: string | undefined): SecondaryEnabledGuard {
    const config = { get: (key: string) => (key === 'SECONDARY_ENABLED' ? value : undefined) };
    return new SecondaryEnabledGuard(config as unknown as ConfigService);
  }

  it('미설정이면 통과한다 — 기본값은 현재 동작(켜짐)을 유지한다', () => {
    expect(guardWith(undefined).canActivate()).toBe(true);
  });

  it("'true' 면 통과한다", () => {
    expect(guardWith('true').canActivate()).toBe(true);
  });

  it("'false' 면 막는다", () => {
    expect(() => guardWith('false').canActivate()).toThrow(DomainError);
  });

  it('403 이 아니라 404 다 — 끈 기능은 배포되지 않은 것과 구분될 이유가 없다', () => {
    try {
      guardWith('false').canActivate();
      throw new Error('막았어야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).kind).toBe('NOT_FOUND');
    }
  });
});
