import { buildLockName } from './mysql-job-lock';
import { JOB } from './job-gate';

/**
 * 락의 **동작**(동시에 하나만 통과하는가)은 여기서 검증하지 않는다. 그건 MySQL 세션 사이의
 * 일이라 진짜 서버가 있어야 확인되고, 실제로 실 DB 스모크(test/flow.smoke-spec.ts)가 본다.
 *
 * 여기서 지키는 것은 그 앞단의 순수 규칙이다 — **이름을 잘못 만들면 락이 조용히 어긋난다.**
 */
describe('MySQL 배치 락 이름', () => {
  it('네임스페이스를 붙인다 — GET_LOCK 이름 공간은 MySQL 서버 전체가 공유한다', () => {
    expect(buildLockName('observation-sync')).toBe('jellysafe:observation-sync');
  });

  it.each(Object.values(JOB))('실제 배치 이름 %s 는 상한 안에 들어온다', (job) => {
    expect(() => buildLockName(job)).not.toThrow();
    expect(buildLockName(job).length).toBeLessThanOrEqual(64);
  });

  it('상한(64자)을 넘으면 던진다 — MySQL 은 거부 대신 잘라 써서 다른 배치와 겹친다', () => {
    expect(() => buildLockName('x'.repeat(64))).toThrow(/너무 깁니다/);
  });

  it('경계값은 통과한다', () => {
    // 'jellysafe:' 가 10자이므로 54자까지가 정확히 64자다.
    expect(buildLockName('y'.repeat(54))).toHaveLength(64);
    expect(() => buildLockName('y'.repeat(55))).toThrow();
  });
});
