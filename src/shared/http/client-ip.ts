/**
 * 요청의 클라이언트 IP — **위조 가능한 값과 아닌 값을 구분해서** 고른다.
 *
 * `Fly-Client-IP` 는 Fly 프록시가 직접 세팅하며 클라이언트가 보낸 동명 헤더를 덮어쓴다.
 * 반면 `X-Forwarded-For` 는 클라이언트가 미리 값을 심어두면 그 값이 앞쪽에 남는다. 그래서
 * XFF 는 보지 않는다 — 레이트 리밋에서는 우회 수단이 되고, 동의 기록에서는 **거짓 증거**가 된다.
 *
 * Fly 밖(로컬·다른 호스팅)에서는 express 의 req.ip(trust proxy 설정 반영)로, 그마저 없으면
 * 소켓의 원격 주소로 폴백한다. 아무것도 못 얻으면 null 이다 — 'unknown' 같은 문자열을 지어내
 * 기록에 남기면 나중에 진짜 값과 구분되지 않는다.
 */
export interface IpBearingRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/** 기록·식별용 클라이언트 IP. 얻지 못하면 null. */
export function clientIpOf(req: IpBearingRequest): string | null {
  const flyIp = req.headers?.['fly-client-ip'];
  if (typeof flyIp === 'string' && flyIp.length > 0) return flyIp;

  const ip = req.ip;
  if (typeof ip === 'string' && ip.length > 0) return ip;

  const remote = req.socket?.remoteAddress;
  return typeof remote === 'string' && remote.length > 0 ? remote : null;
}

/** 레이트 리밋 버킷 키용. 값이 없으면 하나로 묶어야 하므로 'unknown' 으로 접는다. */
export function clientIpKeyOf(req: IpBearingRequest): string {
  return clientIpOf(req) ?? 'unknown';
}
