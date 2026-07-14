import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS_ORIGIN 문자열 → Nest enableCors 의 origin 옵션.
 *
 * 콤마로 구분된 항목마다 정확히 일치하는 origin 을 허용하고, `*` 이 포함된 항목은
 * 와일드카드로 취급한다. Vercel 은 브랜치/커밋마다 프리뷰 도메인을 새로 만들기 때문에
 * (jellysafe-public-git-feat-x-team.vercel.app 등) 정확 일치만으로는 프리뷰가 전부 막힌다.
 *
 *   CORS_ORIGIN="https://foo.vercel.app,https://foo-*.vercel.app,http://localhost:*"
 *
 * `*` 는 호스트 한 세그먼트(또는 포트) 안에서만 확장된다 — `.` 을 넘지 않으므로
 * `https://foo-*.vercel.app` 가 `https://evil.com/foo-x.vercel.app` 같은 값에 매칭되지 않는다.
 *
 * 미지정(빈 문자열)이면 모든 origin 을 허용한다(로컬 개발 편의).
 */
export function buildCorsOrigin(raw?: string | null): CorsOptions['origin'] {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (entries.length === 0) return true;

  const exact = new Set<string>();
  const patterns: RegExp[] = [];
  for (const entry of entries) {
    if (entry.includes('*')) patterns.push(toRegExp(entry));
    else exact.add(entry);
  }

  return (origin, callback) => {
    // origin 이 없으면 브라우저 요청이 아니다(curl, 서버 간 호출, 헬스체크) → 통과.
    if (!origin) return callback(null, true);
    const allowed = exact.has(origin) || patterns.some((p) => p.test(origin));
    // 거부는 예외가 아니라 "헤더를 붙이지 않음"이다. 브라우저가 알아서 차단한다.
    callback(null, allowed);
  };
}

function toRegExp(entry: string): RegExp {
  // 정규식 메타문자는 이스케이프하되 `*` 은 와일드카드로 남긴다.
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '[^./]*');
  return new RegExp(`^${body}$`);
}
