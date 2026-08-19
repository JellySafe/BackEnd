import { buildCorsOrigin } from './cors-origin';

/** origin 함수를 동기적으로 호출해 허용 여부만 뽑는다. */
function allows(raw: string | undefined, origin: string | undefined): boolean {
  const fn = buildCorsOrigin(raw);
  if (typeof fn !== 'function') return fn === true;
  let allowed = false;
  fn(origin, (_err, result) => {
    allowed = result === true;
  });
  return allowed;
}

describe('buildCorsOrigin', () => {
  it('미지정이면 모든 origin 을 허용한다(로컬 개발)', () => {
    expect(buildCorsOrigin(undefined)).toBe(true);
    expect(buildCorsOrigin('')).toBe(true);
    expect(buildCorsOrigin('  ')).toBe(true);
  });

  it('정확히 일치하는 origin 만 허용한다', () => {
    const raw = 'https://a.vercel.app,https://b.vercel.app';
    expect(allows(raw, 'https://a.vercel.app')).toBe(true);
    expect(allows(raw, 'https://b.vercel.app')).toBe(true);
    expect(allows(raw, 'https://evil.com')).toBe(false);
  });

  it('trailing slash 가 붙은 값은 별개 origin 이라 허용되지 않는다', () => {
    expect(allows('https://a.vercel.app', 'https://a.vercel.app/')).toBe(false);
  });

  it('와일드카드로 Vercel 프리뷰 도메인을 허용한다', () => {
    const raw = 'https://jellysafe-public-*.vercel.app';
    expect(allows(raw, 'https://jellysafe-public-git-feat-x-team.vercel.app')).toBe(true);
    expect(allows(raw, 'https://jellysafe-public-abc123.vercel.app')).toBe(true);
    // 다른 프로젝트의 프리뷰는 막힌다.
    expect(allows(raw, 'https://jellysafe-admin-abc123.vercel.app')).toBe(false);
  });

  it('와일드카드가 점(.)을 넘지 않아 서브도메인 우회를 막는다', () => {
    const raw = 'https://jellysafe-public-*.vercel.app';
    expect(allows(raw, 'https://jellysafe-public-x.evil.com.vercel.app')).toBe(false);
    expect(allows(raw, 'https://evil.com')).toBe(false);
  });

  it('localhost 는 포트 와일드카드로 허용한다', () => {
    const raw = 'http://localhost:*';
    expect(allows(raw, 'http://localhost:3000')).toBe(true);
    expect(allows(raw, 'http://localhost:5173')).toBe(true);
    // 프로토콜/호스트가 다르면 막힌다.
    expect(allows(raw, 'https://localhost:3000')).toBe(false);
    expect(allows(raw, 'http://notlocalhost:3000')).toBe(false);
  });

  it('origin 헤더가 없으면(서버 간 호출·헬스체크) 통과시킨다', () => {
    expect(allows('https://a.vercel.app', undefined)).toBe(true);
  });
});
