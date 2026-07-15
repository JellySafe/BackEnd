import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { AdminAuthGuard } from './admin-auth.guard';
import { SystemAuthGuard } from './system-auth.guard';

/**
 * 전역 인증 모듈.
 * - JwtModule 을 전역 등록해 user 컨텍스트가 토큰을 발급하고 가드가 검증한다.
 * - AdminAuthGuard 를 전역 가드(APP_GUARD)로 등록한다(/admin 경로만 실제 보호).
 * - SystemAuthGuard 를 전역 가드로 함께 등록한다(/system 경로만 보호, x-system-key 헤더).
 *   두 가드는 서로 다른 경로만 검사하고 나머지는 통과시키므로 경로별로 정확히 하나만 실효한다.
 *   (`/public/*` 은 둘 다 통과 = 기존대로 비로그인 접근 가능)
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_SECRET') ?? 'jellysafe-dev-secret-change-me',
        // expiresIn 은 ms 라이브러리의 문자열 리터럴 타입이라 동적 string 을 캐스팅한다.
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES') ?? '12h') as `${number}h` },
      }),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: AdminAuthGuard },
    { provide: APP_GUARD, useClass: SystemAuthGuard },
  ],
  exports: [JwtModule],
})
export class AuthModule {}
