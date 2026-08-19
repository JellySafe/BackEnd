import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SystemAuthGuard } from './system-auth.guard';
import { GuestTokenService } from './guest-token.service';
import { GuestTokenController } from './guest-token.controller';

/**
 * 전역 인증 모듈.
 * - JwtModule 을 전역 등록해 user 컨텍스트가 토큰을 발급하고 가드가 검증한다.
 * - JwtAuthGuard 를 전역 가드(APP_GUARD)로 등록한다(/admin 은 토큰 필수, 그 외는 선택).
 * - SystemAuthGuard 를 전역 가드로 함께 등록한다(/system 경로만 보호, x-system-key 헤더).
 *   두 가드는 서로 다른 경로만 검사하고 나머지는 통과시키므로 경로별로 정확히 하나만 실효한다.
 *   (`/public/*` 은 비로그인 접근이 계속 가능하되, Bearer 토큰이 실려 오면 req.user 가 채워진다)
 * - GuestTokenService/Controller: 비로그인 사용자의 **서명된** 식별 토큰을 발급·검증한다.
 *   공개 컨텍스트(favorite/notification)가 소유자 확인에 쓰므로 전역으로 export 한다.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        // 기본값을 두지 않는다. env 검증이 JWT_SECRET(32자 이상)을 이미 강제하므로,
        // 여기에 폴백을 남겨두면 "검증을 통과 못 했는데도 뜨는 경로"를 만드는 셈이다.
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // expiresIn 은 ms 라이브러리의 문자열 리터럴 타입이라 동적 string 을 캐스팅한다.
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES') ?? '12h') as `${number}h` },
      }),
    }),
  ],
  controllers: [GuestTokenController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: SystemAuthGuard },
    GuestTokenService,
  ],
  exports: [JwtModule, GuestTokenService],
})
export class AuthModule {}
