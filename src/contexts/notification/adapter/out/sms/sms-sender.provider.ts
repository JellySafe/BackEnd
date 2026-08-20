import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_SENDER } from '../../../application/port/out/sms-sender.port';
import { NotificationConfig } from '../../../notification.config';
import { DisabledSmsSender } from './disabled-sms.sender';
import { SensSmsSender } from './sens-sms.sender';

/**
 * SMS 발송 사업자 선택 (SMS_PROVIDER).
 *
 * 기본은 `none` 이다 — **문자는 건당 과금이고 발신번호 사전등록이 필요한 채널**이라,
 * 설정하지 않은 환경에서 실수로 나가는 일이 없어야 한다. 켤 때만 명시적으로 켠다.
 *
 * `sens` 인데 자격증명이 불완전하면 어댑터가 스스로 비활성 상태가 되고 경고를 남긴다
 * (부팅을 막지는 않는다 — 문자는 부가 채널이고, 인앱·푸시는 그대로 동작해야 한다).
 */
export const smsSenderProvider: Provider = {
  provide: SMS_SENDER,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const config = new NotificationConfig(configService);
    if (config.smsProvider === 'sens') {
      new Logger('SmsSender').log(
        `SMS 발송: 네이버 클라우드 SENS (최소 위험 단계=${config.smsMinRiskLevel})`,
      );
      return new SensSmsSender(configService);
    }
    return new DisabledSmsSender();
  },
};
