/**
 * PDF 파서를 못 불러와도 **앱은 뜬다** (부팅 회귀 방지).
 *
 * ── 실제로 났던 일 ───────────────────────────────────────────────────────────────────
 * 운영 사양 부하 측정을 하려고 운영 이미지를 처음 띄웠더니 컨테이너가 곧바로 죽었다.
 *
 *     Error: DOMMatrix is not defined
 *     at /app/node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs:1
 *
 * pdf-parse 는 pdf.js 를 쓰고, 그건 `@napi-rs/canvas` 라는 **선택적 네이티브 패키지**로
 * DOM 을 흉내 낸다. 그 바이너리가 없으면 **모듈을 읽는 순간** 터진다.
 *
 * 그리고 그 바이너리는 없을 수 있다 — npm 은 **선택적 의존성 설치 실패를 조용히 넘긴다.**
 * 이미지 빌드 중 네트워크가 한 번 흔들리면 `npm ci` 도 `docker build` 도 성공으로 끝나고,
 * 그렇게 만들어진 이미지만 뜨지 못한다. 빌드 로그에는 아무 표시도 남지 않는다.
 *
 * ── 왜 이 테스트가 필요한가 ──────────────────────────────────────────────────────────
 * 이 컬렉터가 하는 일은 국립수산과학원 주간보고 PDF 에서 출현 기록을 뽑는 것 하나다.
 * 그게 안 되면 **그 자료원만** 비어야 한다. 위험도 조회·알림·제보는 PDF 와 아무 상관이
 * 없는데, 최상단 import 하나 때문에 그 전부가 함께 죽었다.
 *
 * 되돌리기도 쉽다 — 누군가 편의상 파일 맨 위로 import 를 올리면 그날로 다시 그렇게 된다.
 * 그 회귀는 **테스트도 로컬 실행도 통과하고**(개발 기기에는 바이너리가 있다) 배포에서만
 * 드러난다. 그래서 여기서 못을 박는다.
 */

import type { ConfigService } from '@nestjs/config';

// pdf-parse 를 불러오는 순간 터지게 만든다 — 바이너리가 없는 환경을 재현한다.
jest.mock('pdf-parse', () => {
  throw new Error('DOMMatrix is not defined');
});

describe('NIFS 수집기 — PDF 파서가 없어도 앱이 뜬다', () => {
  it('모듈을 읽는 것만으로 터지지 않는다', async () => {
    // 최상단에서 import 하면 이 로딩이 그대로 터진다(= 운영에서 기동 실패).
    await expect(import('./nifs-jellyfish.collector')).resolves.toBeDefined();
  });

  it('클래스를 만들 수 있다 — DI 컨테이너가 인스턴스화하는 지점이다', async () => {
    const { NifsJellyfishCollector } = await import('./nifs-jellyfish.collector');

    const collector = new NifsJellyfishCollector({
      get: () => undefined,
    } as unknown as ConfigService);
    expect(collector.isConfigured).toBe(false);
  });
});
