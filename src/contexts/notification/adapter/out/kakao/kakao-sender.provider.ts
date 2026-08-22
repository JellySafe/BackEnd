import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KAKAO_SENDER } from '../../../application/port/out/kakao-sender.port';
import { NotificationConfig } from '../../../notification.config';
import { DisabledKakaoSender } from './disabled-kakao.sender';
import { SensAlimtalkSender } from './sens-alimtalk.sender';

/**
 * 알림톡 발송 사업자 선택.
 *
 * SMS 와 같은 자격증명(SENS)을 쓰지만 **별도로 켠다.** 알림톡에는 문자에 없는 준비물이
 * 더 있기 때문이다 — 카카오 비즈니스 채널(발신 프로필)과 **템플릿 심사 승인**.
 * 문자를 켰다고 알림톡이 자동으로 켜지면, 승인 안 된 템플릿으로 보내다 전부 거부된다.
 */
export const kakaoSenderProvider: Provider = {
  provide: KAKAO_SENDER,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const config = new NotificationConfig(configService);
    if (config.alimtalk !== null && config.sens !== null) {
      const codes = Object.keys(config.alimtalk.templateCodes);
      new Logger('KakaoSender').log(
        `알림톡 발송: 네이버 클라우드 SENS (승인 템플릿 ${codes.length}종: ${codes.join(', ') || '없음'})`,
      );
      return new SensAlimtalkSender(configService);
    }
    return new DisabledKakaoSender();
  },
};
