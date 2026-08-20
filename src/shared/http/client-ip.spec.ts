import { clientIpKeyOf, clientIpOf } from './client-ip';

describe('클라이언트 IP 추출', () => {
  it('Fly-Client-IP 를 최우선으로 쓴다 (프록시가 덮어써 위조 불가)', () => {
    expect(
      clientIpOf({ headers: { 'fly-client-ip': '203.0.113.7' }, ip: '10.0.0.1' }),
    ).toBe('203.0.113.7');
  });

  it('X-Forwarded-For 는 보지 않는다 — 클라이언트가 심어 둘 수 있는 값이다', () => {
    expect(
      clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '10.0.0.1' }),
    ).toBe('10.0.0.1');
  });

  it('Fly 밖에서는 req.ip 로 폴백한다', () => {
    expect(clientIpOf({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('req.ip 도 없으면 소켓 주소를 쓴다', () => {
    expect(clientIpOf({ socket: { remoteAddress: '::1' } })).toBe('::1');
  });

  it('아무것도 없으면 null — 지어낸 값을 기록에 남기지 않는다', () => {
    expect(clientIpOf({})).toBeNull();
    expect(clientIpOf({ headers: { 'fly-client-ip': '' }, ip: '' })).toBeNull();
  });

  it('리밋 키는 값이 없을 때 하나로 접는다', () => {
    expect(clientIpKeyOf({})).toBe('unknown');
    expect(clientIpKeyOf({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
