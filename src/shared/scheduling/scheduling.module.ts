import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import { KyselyService } from '@shared/persistence/kysely/kysely.service';
import { JobGate } from './job-gate';
import { JobLockPort, JOB_LOCK } from './job-lock.port';
import { InProcessJobLock } from './in-process-job-lock';
import { MysqlJobLock } from './mysql-job-lock';

/**
 * 배치 실행 공용 인프라.
 *
 * JobGate 는 여러 컨텍스트(observation/risk)의 스케줄러와 `/system/*` 컨트롤러가 **같은 인스턴스**를
 * 공유해야 의미가 있다(같은 배치의 서로 다른 입구를 하나의 게이트로 묶는 것이 목적이므로).
 * 그래서 전역 모듈로 등록한다 — 컨텍스트마다 provider 를 따로 두면 게이트가 갈라져 무의미해진다.
 *
 * ── 락 구현 선택 (JOB_LOCK_DRIVER) ───────────────────────────────────────────────────
 * 기본값은 `mysql` 이다. 인프로세스 락은 **머신이 하나라는 전제에서만** 맞는데, 그 전제가
 * 깨지는 순간(`fly scale count 2`) 게이트가 조용히 사라진다는 것이 문제다. 크론이 양쪽에서
 * 동시에 돌아도 로그에는 각자 정상으로 찍히고, 증상은 risk_scores 중복·트랜잭션 경합처럼
 * 배치와 멀어 보이는 형태로 나타난다.
 *
 * MySQL 락은 머신이 하나일 때도 정확히 같게 동작하므로(그저 한 번 더 확인할 뿐이다),
 * **맞는 쪽을 기본값으로 두고 필요할 때 끄는** 편이 낫다. 비용은 배치당 왕복 두 번과
 * 실행 동안 붙잡는 커넥션 하나다(mysql-job-lock.ts 참고).
 */
@Global()
@Module({
  providers: [
    {
      provide: JOB_LOCK,
      inject: [ConfigService, KyselyService],
      useFactory: (config: ConfigService, db: KyselyService): JobLockPort => {
        const driver = new AppConfig(config).jobLockDriver;
        const logger = new Logger(SchedulingModule.name);

        if (driver === 'memory') {
          logger.warn(
            '배치 락이 인프로세스 모드다(JOB_LOCK_DRIVER=memory). ' +
              '머신을 둘 이상으로 늘리면 같은 배치가 동시에 돌 수 있다.',
          );
          return new InProcessJobLock();
        }

        logger.log('배치 락: MySQL GET_LOCK (인스턴스가 여럿이어도 하나만 실행된다)');
        return new MysqlJobLock(db);
      },
    },
    JobGate,
  ],
  exports: [JobGate],
})
export class SchedulingModule {}
