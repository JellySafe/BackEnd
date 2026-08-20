import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import { NotFoundError } from '@shared/kernel/domain-error';

/**
 * 2차 기능(EX-001~004) 전체를 한 스위치로 끄는 가드.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────────────
 * 제휴 API·구독·모델 관리는 **쓰지 않는 환경에서도 열려 있다.** 특히 `/partner/v1/*` 은
 * 로그인도 관리자 토큰도 아닌 **별도 자격증명(x-api-key)** 으로 들어오는 문이라, 제휴사가
 * 한 곳도 없는 환경에서는 지키기만 하고 얻는 것이 없는 입구다.
 *
 * 안 쓰는 기능은 꺼 둘 수 있어야 한다 — 공격면은 "실제로 쓰는 것" 만큼만 열어 두는 것이 맞다.
 *
 * ── 왜 모듈을 통째로 빼지 않고 가드인가 ──────────────────────────────────────────────
 * 모듈 등록은 **DI 가 준비되기 전에** 결정된다. 그 시점에 설정을 읽으려면 `process.env` 를
 * 직접 보는 수밖에 없는데, `ConfigModule.forRoot()` 는 비동기라 그때 `.env` 파일 값은 아직
 * 들어와 있지 않다. 그러면 "OS 환경변수로 주면 되는데 .env 에 적으면 안 되는" 설정이 하나
 * 생긴다 — 이 저장소가 계속 피해 온 종류의 함정이다.
 *
 * 가드는 DI 를 타므로 **검증을 통과한 설정**을 그대로 읽는다. 대신 라우트는 등록된 채 남는데,
 * 밖에서 보이는 결과는 같다(아래 404 참고).
 *
 * ── 왜 403 이 아니라 404 인가 ────────────────────────────────────────────────────────
 * 403 은 "여기 뭔가 있는데 너는 못 본다" 는 뜻이라 **경로의 존재를 알려준다.** 끈 기능은
 * 배포되지 않은 것과 구분될 이유가 없으므로 404 로 답한다.
 *
 * ── 경로에 따라 보이는 결과가 다르다 (의도된 것) ─────────────────────────────────────
 * 전역 가드(JwtAuthGuard)가 컨트롤러 가드보다 **먼저** 돈다. 그래서 실제로 관측되는 값은:
 *
 *   /partner/v1/*  자격증명 없이도 곧바로 404   ← 키를 보기 전에 닫힌다(이게 핵심 목표다)
 *   /admin/*       토큰 없으면 401, 있으면 404  ← 401 은 모든 관리자 경로가 똑같이 주는 값이라
 *                                                여기서 새어 나가는 정보가 따로 없다
 *
 * 즉 별도 자격증명으로 들어오는 문(`/partner/v1/*`)은 완전히 닫히고, 관리자 경로는 인증을
 * 통과한 사람에게만 "없는 기능" 으로 보인다. 실 컨테이너로 확인한 동작이다.
 */
@Injectable()
export class SecondaryEnabledGuard implements CanActivate {
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = new AppConfig(configService);
  }

  canActivate(): boolean {
    if (this.config.secondaryEnabled) return true;
    throw new NotFoundError('NOT_FOUND', '요청한 경로를 찾을 수 없습니다.');
  }
}
