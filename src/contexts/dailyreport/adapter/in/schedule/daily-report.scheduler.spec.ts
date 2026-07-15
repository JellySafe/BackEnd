import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GenerateDailyReportCommand } from '../../../application/port/in/daily-report-use-cases';
import { DailyReportScheduler } from './daily-report.scheduler';

/**
 * 스케줄러가 고르는 **대상일**이 KST 기준 어제인지 못 박는다.
 *
 * 수정 전: `normalizeReportDate(new Date())` 후 `setUTCDate(-1)` → UTC 기준 어제.
 * 컨테이너가 UTC 라 UTC 00:10(=KST 09:10) 발화에서는 날짜 라벨이 우연히 맞아 보였지만,
 * 담고 있는 구간은 UTC 하루(KST 09:00~익일 09:00)였고, 크론을 KST 00:10(=UTC 전날 15:10)로
 * 옮기는 순간 대상일까지 하루 밀렸다. 이제 발화 시각/서버 TZ 와 무관하게 같은 날을 고른다.
 *
 * 단언은 UTC 인스턴트 기준이라 TZ=UTC / TZ=Asia/Seoul 어느 쪽으로 돌려도 동일하게 통과한다.
 */

function build() {
  const commands: GenerateDailyReportCommand[] = [];
  const config = { get: () => undefined } as unknown as ConfigService;
  const registry = { addCronJob: jest.fn() } as unknown as SchedulerRegistry;
  const generate = {
    generate: jest.fn(async (cmd: GenerateDailyReportCommand) => {
      commands.push(cmd);
      return undefined as never;
    }),
  };
  const beachIds = { listActiveBeachIds: jest.fn(async () => [1, 2]) };

  const scheduler = new DailyReportScheduler(config, registry, generate, beachIds);
  return { scheduler, commands, generate, beachIds };
}

describe('DailyReportScheduler — 대상일 선정 (KST 어제)', () => {
  it('UTC 00:10 발화(= KST 09:10) → 07-13 리포트', async () => {
    const { scheduler, commands } = build();
    await scheduler.run(new Date('2026-07-14T00:10:00Z'));
    expect(commands).toHaveLength(2); // 활성 해변 2곳
    expect(commands[0].date.toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(commands.map((c) => c.beachId)).toEqual([1, 2]);
  });

  it('KST 00:10 발화(= UTC 전날 15:10) → 여전히 07-13 리포트 (수정 전에는 07-12 였다)', async () => {
    const { scheduler, commands } = build();
    await scheduler.run(new Date('2026-07-13T15:10:00Z'));
    expect(commands[0].date.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('KST 자정 직전(23:59:59 = UTC 14:59:59) 발화여도 대상일은 그 KST 날짜의 전날', async () => {
    const { scheduler, commands } = build();
    // KST 07-14 23:59:59 → 어제 = 07-13
    await scheduler.run(new Date('2026-07-14T14:59:59Z'));
    expect(commands[0].date.toISOString()).toBe('2026-07-13T00:00:00.000Z');
  });

  it('월 경계: KST 03-01 00:10 발화 → 02-28', async () => {
    const { scheduler, commands } = build();
    await scheduler.run(new Date('2026-02-28T15:10:00Z')); // KST 03-01 00:10
    expect(commands[0].date.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('해변별 실패는 격리되고 나머지는 계속 생성한다', async () => {
    const { scheduler, generate } = build();
    generate.generate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined as never);
    await expect(scheduler.run(new Date('2026-07-14T00:10:00Z'))).resolves.toBeUndefined();
    expect(generate.generate).toHaveBeenCalledTimes(2);
  });
});
