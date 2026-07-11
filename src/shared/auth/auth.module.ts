import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { AdminAuthGuard } from './admin-auth.guard';

/**
 * 전역 인증 모듈.
 * - JwtModule 을 전역 등록해 user 컨텍스트가 토큰을 발급하고 가드가 검증한다.
 * - AdminAuthGuard 를 전역 가드(APP_GUARD)로 등록한다(/admin 경로만 실제 보호).
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
  providers: [{ provide: APP_GUARD, useClass: AdminAuthGuard }],
  exports: [JwtModule],
})
export class AuthModule {}
