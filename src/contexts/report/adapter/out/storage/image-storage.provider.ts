import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REPORT_IMAGE_STORAGE } from '../../../application/port/out/report-image-storage.port';
import { ReportConfig } from '../../../report.config';
import { LocalImageStorageAdapter } from './local-image-storage.adapter';
import { S3ImageStorageAdapter } from './s3-image-storage.adapter';

/**
 * 이미지 저장 드라이버 선택 (STORAGE_DRIVER).
 *
 * 부팅 로그에 **어느 드라이버로 떴는지** 남긴다. 저장소 설정이 틀리면 증상이
 * "사진이 가끔 안 열린다" 처럼 늦게·모호하게 나타나므로, 기동 시점에 사실을 박아 둔다.
 *
 * s3 인데 버킷이 비어 있으면 **기동을 막는다.** 그대로 뜨면 업로드 때마다 실패하는데,
 * 그건 사용자 눈에는 "제보가 안 된다" 로만 보이고 원인은 로그를 뒤져야 나온다.
 */
export const reportImageStorageProvider: Provider = {
  provide: REPORT_IMAGE_STORAGE,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const config = new ReportConfig(configService);
    const logger = new Logger('ReportImageStorage');

    if (config.storageDriver === 's3') {
      if (config.s3Bucket === '') {
        throw new Error('STORAGE_DRIVER=s3 인데 S3_BUCKET 이 비어 있습니다.');
      }
      logger.log(
        `제보 이미지 저장소: S3 호환 (bucket=${config.s3Bucket}, endpoint=${config.s3Endpoint ?? 'AWS 기본'})`,
      );
      return new S3ImageStorageAdapter(configService);
    }

    logger.log('제보 이미지 저장소: 로컬 볼륨 (단일 머신 전용 — 머신을 늘리면 사진이 갈라진다)');
    return new LocalImageStorageAdapter(configService);
  },
};
