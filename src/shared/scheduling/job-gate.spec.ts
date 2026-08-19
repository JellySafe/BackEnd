import { JobGate } from './job-gate';

/**
 * 배치 중복 실행 방지 게이트.
 *
 * 지키려는 것: **같은 배치 이름으로 들어오는 모든 입구가 하나의 문을 지난다.**
 * 예전에는 스케줄러가 자기 `private running` 플래그만 봐서, `POST /system/observations/sync`
 * 수동 트리거가 크론이 도는 중에 눌리면 같은 배치가 겹쳐 돌았다.
 */
describe('JobGate', () => {
  let gate: JobGate;

  beforeEach(() => {
    gate = new JobGate();
  });

  /** 외부에서 결말을 정할 수 있는 promise. 배치가 "도는 중"인 상태를 만드는 데 쓴다. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('놀고 있으면 실행하고 결과를 돌려준다', async () => {
    const outcome = await gate.run('job', () => Promise.resolve(42));
    expect(outcome).toEqual({ ran: true, result: 42 });
  });

  it('이미 도는 중이면 실행하지 않는다 — 서로 다른 입구가 같은 이름을 쓰면 하나만 통과한다', async () => {
    const gateKeeper = deferred<string>();
    const first = gate.run('observation-sync', () => gateKeeper.promise);

    // 첫 번째가 아직 끝나지 않은 시점에 두 번째(수동 트리거 격)가 들어온다.
    const second = await gate.run('observation-sync', () => Promise.resolve('두 번째'));
    expect(second).toEqual({ ran: false });

    gateKeeper.resolve('첫 번째');
    expect(await first).toEqual({ ran: true, result: '첫 번째' });
  });

  it('이름이 다르면 서로를 막지 않는다', async () => {
    const held = deferred<void>();
    const running = gate.run('observation-sync', () => held.promise);

    const other = await gate.run('risk-recalc-all', () => Promise.resolve('ok'));
    expect(other).toEqual({ ran: true, result: 'ok' });

    held.resolve();
    await running;
  });

  it('끝나면 문이 다시 열린다', async () => {
    await gate.run('job', () => Promise.resolve(1));
    const again = await gate.run('job', () => Promise.resolve(2));
    expect(again).toEqual({ ran: true, result: 2 });
  });

  it('실행이 예외로 끝나도 문이 잠기지 않는다 — 한 번 실패한 배치가 영영 막히면 안 된다', async () => {
    await expect(gate.run('job', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // 잠긴 채 남았다면 여기서 ran:false 가 나온다.
    const after = await gate.run('job', () => Promise.resolve('복구'));
    expect(after).toEqual({ ran: true, result: '복구' });
  });

  it('예외는 삼키지 않고 호출자에게 그대로 전달한다', async () => {
    // 게이트는 중복만 막는다. 실패 처리(로그·failed 기록)는 호출자의 책임이다.
    await expect(gate.run('job', () => Promise.reject(new Error('원인'))))
      .rejects.toThrow('원인');
  });

  it('isRunning 으로 상태를 볼 수 있다', async () => {
    const held = deferred<void>();
    const running = gate.run('job', () => held.promise);

    expect(gate.isRunning('job')).toBe(true);
    expect(gate.isRunning('other')).toBe(false);

    held.resolve();
    await running;
    expect(gate.isRunning('job')).toBe(false);
  });

  it('동시에 여러 요청이 몰려도 하나만 통과한다', async () => {
    const held = deferred<void>();
    let executions = 0;

    const attempts = Array.from({ length: 10 }, () =>
      gate.run('job', () => {
        executions += 1;
        return held.promise;
      }),
    );

    held.resolve();
    const outcomes = await Promise.all(attempts);

    expect(executions).toBe(1);
    expect(outcomes.filter((o) => o.ran)).toHaveLength(1);
  });
});
