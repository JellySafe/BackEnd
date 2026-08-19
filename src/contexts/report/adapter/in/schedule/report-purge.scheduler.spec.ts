import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ReportPurgeScheduler } from './report-purge.scheduler';
import { PurgeTarget, ReportPurgePort } from '../../../application/port/out/report-purge.port';
import { ReportImageStoragePort } from '../../../application/port/out/report-image-storage.port';

/**
 * PRIV-003 파기 배치.
 *
 * 예전에는 DB 의 image_url/lat/lng 만 마스킹하고 **실제 사진 파일은 그대로 뒀다.**
 * "파기했다"고 기록된 제보의 사진이 `/uploads/*` 로 계속 열려 있었고(보관정책 위반),
 * 1GB 볼륨에 파일만 쌓였다. 이 테스트가 두 단계(마스킹 + 파일 삭제)를 함께 고정한다.
 */
describe('ReportPurgeScheduler', () => {
  const configService = { get: () => undefined } as unknown as ConfigService;
  const registry = {} as SchedulerRegistry;

  function build(targets: PurgeTarget[], deleteResult: (url: string) => boolean = () => true) {
    const purge: ReportPurgePort = { purgeExpired: jest.fn().mockResolvedValue(targets) };
    const images: ReportImageStoragePort = {
      deleteByUrl: jest.fn((url: string) => Promise.resolve(deleteResult(url))),
    };
    return {
      scheduler: new ReportPurgeScheduler(configService, registry, purge, images),
      purge,
      images,
    };
  }

  it('마스킹 대상의 이미지 파일을 지운다', async () => {
    const { scheduler, images } = build([
      { reportId: 1, imageUrl: '/uploads/1720000000000-a1b2c3d4e5f60718.jpg' },
      { reportId: 2, imageUrl: '/uploads/1720000000001-b1b2c3d4e5f60718.png' },
    ]);

    await scheduler.run();

    expect(images.deleteByUrl).toHaveBeenCalledTimes(2);
    expect(images.deleteByUrl).toHaveBeenCalledWith('/uploads/1720000000000-a1b2c3d4e5f60718.jpg');
    expect(images.deleteByUrl).toHaveBeenCalledWith('/uploads/1720000000001-b1b2c3d4e5f60718.png');
  });

  it('DB 마스킹을 먼저 하고 파일을 지운다', async () => {
    // 순서가 반대면, 그 사이에 들어온 조회가 "URL 은 있는데 파일이 없는" 깨진 이미지를 본다.
    const order: string[] = [];
    const purge: ReportPurgePort = {
      purgeExpired: jest.fn(() => {
        order.push('mask');
        return Promise.resolve([{ reportId: 1, imageUrl: '/uploads/1720000000000-a1b2c3d4e5f60718.jpg' }]);
      }),
    };
    const images: ReportImageStoragePort = {
      deleteByUrl: jest.fn(() => {
        order.push('unlink');
        return Promise.resolve(true);
      }),
    };

    await new ReportPurgeScheduler(configService, registry, purge, images).run();

    expect(order).toEqual(['mask', 'unlink']);
  });

  it('이미지가 없는 제보는 파일 삭제를 시도하지 않는다', async () => {
    const { scheduler, images } = build([
      { reportId: 1, imageUrl: null },
      { reportId: 2, imageUrl: '' }, // 이미 파기된 센티넬
    ]);

    await scheduler.run();

    expect(images.deleteByUrl).not.toHaveBeenCalled();
  });

  it('파일 하나가 안 지워져도 나머지는 계속 지운다', async () => {
    // 한 건의 권한 오류가 그날의 파기 전체를 멈추면, 남은 사진들이 다음 주기까지 그대로 남는다.
    const { scheduler, images } = build(
      [
        { reportId: 1, imageUrl: '/uploads/1720000000000-a1b2c3d4e5f60718.jpg' },
        { reportId: 2, imageUrl: '/uploads/1720000000001-b1b2c3d4e5f60718.jpg' },
        { reportId: 3, imageUrl: '/uploads/1720000000002-c1b2c3d4e5f60718.jpg' },
      ],
      (url) => !url.includes('1720000000001'),
    );

    await scheduler.run();

    expect(images.deleteByUrl).toHaveBeenCalledTimes(3);
  });

  it('파기 대상이 없으면 아무것도 하지 않는다', async () => {
    const { scheduler, images } = build([]);

    await scheduler.run();

    expect(images.deleteByUrl).not.toHaveBeenCalled();
  });

  it('DB 마스킹이 실패하면 파일을 지우지 않는다 — 지울 대상을 모르는 채 삭제하지 않는다', async () => {
    const purge: ReportPurgePort = {
      purgeExpired: jest.fn().mockRejectedValue(new Error('DB 연결 끊김')),
    };
    const images: ReportImageStoragePort = { deleteByUrl: jest.fn() };

    // 배치는 예외를 삼키고 로그만 남긴다(다음 주기에 다시 시도한다).
    await expect(
      new ReportPurgeScheduler(configService, registry, purge, images).run(),
    ).resolves.toBeUndefined();

    expect(images.deleteByUrl).not.toHaveBeenCalled();
  });
});
