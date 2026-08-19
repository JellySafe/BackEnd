import { Global, Module } from '@nestjs/common';
import { JobGate } from './job-gate';

/**
 * 배치 실행 공용 인프라.
 *
 * JobGate 는 여러 컨텍스트(observation/risk)의 스케줄러와 `/system/*` 컨트롤러가 **같은 인스턴스**를
 * 공유해야 의미가 있다(같은 배치의 서로 다른 입구를 하나의 게이트로 묶는 것이 목적이므로).
 * 그래서 전역 모듈로 등록한다 — 컨텍스트마다 provider 를 따로 두면 게이트가 갈라져 무의미해진다.
 */
@Global()
@Module({
  providers: [JobGate],
  exports: [JobGate],
})
export class SchedulingModule {}
