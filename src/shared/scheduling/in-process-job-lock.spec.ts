import { InProcessJobLock } from './in-process-job-lock';

/** 외부에서 결말을 정할 수 있는 promise. 배치가 "도는 중"인 상태를 만드는 데 쓴다. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('InProcessJobLock', () => {
  let lock: InProcessJobLock;

  beforeEach(() => {
    lock = new InProcessJobLock();
  });

  it('비어 있으면 실행하고 결과를 돌려준다', async () => {
    await expect(lock.withLock('job', () => Promise.resolve(7))).resolves.toEqual({
      ran: true,
      result: 7,
    });
  });

  it('이미 잡혀 있으면 fn 을 아예 부르지 않는다', async () => {
    const held = deferred<void>();
    const first = lock.withLock('job', () => held.promise);

    const fn = jest.fn(() => Promise.resolve('두 번째'));
    await expect(lock.withLock('job', fn)).resolves.toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();

    held.resolve();
    await first;
  });

  it('이름이 다르면 서로를 막지 않는다', async () => {
    const held = deferred<void>();
    const running = lock.withLock('a', () => held.promise);

    await expect(lock.withLock('b', () => Promise.resolve('ok'))).resolves.toEqual({
      ran: true,
      result: 'ok',
    });

    held.resolve();
    await running;
  });

  it('예외로 끝나도 락이 남지 않는다 — 한 번 실패한 배치가 영영 막히면 안 된다', async () => {
    await expect(lock.withLock('job', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    await expect(lock.withLock('job', () => Promise.resolve('복구'))).resolves.toEqual({
      ran: true,
      result: '복구',
    });
  });

  it('동시에 몰려도 정확히 하나만 통과한다 — 검사와 등록 사이에 await 이 없어야 성립한다', async () => {
    const held = deferred<void>();
    let executions = 0;

    const attempts = Array.from({ length: 20 }, () =>
      lock.withLock('job', () => {
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
