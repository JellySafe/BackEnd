import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '@shared/config/app.config';
import { DomainError } from '@shared/kernel/domain-error';

/** 시스템 키를 담는 요청 헤더. */
export const SYSTEM_KEY_HEADER = 'x-system-key';
/** Swagger SecurityScheme 이름(main.ts 의 DocumentBuilder 와 맞춘다). */
export const SYSTEM_KEY_SECURITY = 'system-key';

/** `/system/...` 경로인지. 전역 프리픽스(/api) 유무와 무관하게 매칭한다. */
const SYSTEM_PATH = /\/system(\/|$)/;

/**
 * 전역 시스템 인증 가드. `/system/*` 만 보호한다(그 외 경로는 통과 → JwtAuthGuard 가 처리).
 *
 * 왜 필요한가:
 *   `/system/*` 은 인증 없이 열려 있었고(`POST /api/system/risk/calculate` → 201),
 *   누구나 위험도 재산출·외부 수집을 무제한 트리거할 수 있었다. 재산출은 위험 단계 상승 시
 *   관심 해변 구독자에게 알림을 발송(SYS-005)하므로 DB 부하를 넘어 **알림 스팸**까지 유발된다.
 *
 * 인증 방식:
 *   `x-system-key: <SYSTEM_API_KEY>` 헤더가 일치할 때만 통과. 아니면 401.
 *
 * 관리자 JWT 는 왜 허용하지 않는가:
 *   `/system/*` 은 사람이 아니라 배치/운영자 도구가 부르는 경로다. 관리자 토큰까지 열어두면
 *   (a) 권한 경계가 두 개가 되어 감사 추적이 흐려지고, (b) 관리자 토큰 하나가 새면 알림 발송을
 *   트리거할 수 있게 된다. 운영자가 수동 트리거해야 할 때는 Swagger 의 Authorize 에
 *   시스템 키를 넣으면 되므로(ApiKey 스킴 노출) 실사용도 막히지 않는다.
 *   → 자격증명 하나(시스템 키)로 단순하게 유지한다.
 *
 * SYSTEM_API_KEY 미설정 시:
 *   **통과가 아니라 차단(401)** 한다. 미설정을 "인증 없음"으로 해석하면 키를 넣는 걸 잊은 순간
 *   지금과 똑같이 뚫린 채 배포된다(fail-open). 로컬에서 `/system/*` 을 부르려면 .env 에
 *   SYSTEM_API_KEY 를 넣으면 되고(.env.example 에 개발용 기본값 있음), 스케줄러 배치는
 *   HTTP 를 타지 않고 유스케이스를 직접 호출하므로 키가 없어도 정상 동작한다.
 *   즉 fail-closed 의 비용은 "로컬에서 수동 트리거하려면 한 줄 추가" 뿐이다.
 */
@Injectable()
export class SystemAuthGuard implements CanActivate {
  private readonly logger = new Logger(SystemAuthGuard.name);
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = new AppConfig(configService);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? req.url ?? '';
    if (!SYSTEM_PATH.test(path)) return true;

    const expected = this.config.systemApiKey;
    if (expected === null) {
      // fail-closed. 운영에서 시크릿을 빠뜨린 채 배포되면 열리는 게 아니라 닫힌다.
      this.logger.error(
        `SYSTEM_API_KEY 가 설정되지 않아 ${req.method} ${path} 를 차단했다. ` +
          '이 경로를 쓰려면 환경변수 SYSTEM_API_KEY 를 설정한다(운영은 fly secrets).',
      );
      throw new DomainError(
        'UNAUTHORIZED',
        'SYSTEM_KEY_REQUIRED',
        '시스템 API 호출 권한이 없습니다.',
      );
    }

    const provided = req.headers[SYSTEM_KEY_HEADER];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (typeof value !== 'string' || !safeEqual(value, expected)) {
      throw new DomainError(
        'UNAUTHORIZED',
        'SYSTEM_KEY_REQUIRED',
        '시스템 API 호출 권한이 없습니다.',
      );
    }

    return true;
  }
}

/** 길이 노출/타이밍 차이를 줄인 상수시간 비교. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
