import { Injectable } from '@nestjs/common';
import { JobLockPort } from './job-lock.port';

/**
 * 프로세스 안에서만 유효한 락. **머신이 하나일 때의 구현.**
 *
 * 검사와 등록 사이에 `await` 이 없다는 점이 중요하다. 자바스크립트는 한 번에 한 흐름만
 * 돌기 때문에, 그 구간에 중단점이 없으면 동시에 들어온 요청들 사이에서도 정확히 하나만
 * 통과한다. (중간에 await 를 하나라도 끼우면 열 개가 전부 "비어 있다" 를 보고 지나간다)
 *
 * 머신이 둘 이상이면 각자 자기 Set 만 보므로 이 구현으로는 게이트가 성립하지 않는다.
 * 그때는 MysqlJobLock 을 쓴다(JOB_LOCK_DRIVER=mysql).
 */
@Injectable()
export class InProcessJobLock implements JobLockPort {
  private readonly held = new Set<string>();

  async withLock<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    if (this.held.has(name)) return { ran: false };
    this.held.add(name);
    try {
      return { ran: true, result: await fn() };
    } finally {
      // 예외로 빠져나가도 반드시 푼다. 안 그러면 한 번 실패한 배치가 영영 잠긴다.
      this.held.delete(name);
    }
  }
}
