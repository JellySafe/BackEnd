import { withDeadlockRetry } from './deadlock-retry';

/**
 * 데드락 재시도.
 *
 * ── 왜 이 테스트가 필요한가 ──────────────────────────────────────────────────────────
 * 이 헬퍼가 막는 결함은 **신규 배포 첫 산출에서만** 난다. 두 번째 산출부터는 직전 최신 행이
 * 있어 UPDATE 가 실제 행을 잡으므로 갭 락이 걸리지 않는다. 즉 개발 중에는 거의 안 보이고
 * 하필 처음 띄우는 날에 나온다 — 그래서 조건을 여기서 못 박아 둔다.
 */
describe('withDeadlockRetry', () => {
  /** Prisma 가 데드락에 붙이는 형태 그대로. code 로만 판별한다. */
  const deadlock = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

  it('데드락이면 다시 시도해 성공시킨다', async () => {
    let calls = 0;
    const run = jest.fn(async () => {
      calls += 1;
      if (calls < 3) throw deadlock();
      return 'ok';
    });

    await expect(withDeadlockRetry(run, { attempts: 3 })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('락 대기 초과(P2024)도 같은 원인이라 재시도한다', async () => {
    let first = true;
    const run = jest.fn(async () => {
      if (first) {
        first = false;
        throw Object.assign(new Error('timed out'), { code: 'P2024' });
      }
      return 'ok';
    });

    await expect(withDeadlockRetry(run, { attempts: 2 })).resolves.toBe('ok');
  });

  it('⚠️ 데드락이 아닌 오류는 그대로 던진다 — 반복해도 풀리지 않는다', async () => {
    // 재시도하면 원인이 로그에서 세 배로 늘어나기만 하고, 진짜 문제를 늦게 알게 된다.
    const run = jest.fn(async () => {
      throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
    });

    await expect(withDeadlockRetry(run, { attempts: 3 })).rejects.toThrow('unique constraint');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('code 가 없는 오류도 재시도하지 않는다', async () => {
    const run = jest.fn(async () => {
      throw new Error('그냥 실패');
    });

    await expect(withDeadlockRetry(run, { attempts: 3 })).rejects.toThrow('그냥 실패');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('⚠️ 계속 데드락이면 결국 던진다 — 영원히 붙잡고 있으면 다음 주기와 겹친다', async () => {
    const run = jest.fn(async () => {
      throw deadlock();
    });

    await expect(withDeadlockRetry(run, { attempts: 3 })).rejects.toMatchObject({ code: 'P2034' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('성공하면 재시도하지 않는다', async () => {
    const run = jest.fn(async () => 'ok');

    await expect(withDeadlockRetry(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
