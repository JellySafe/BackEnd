import { DomainError } from '@shared/kernel/domain-error';
import {
  isWebPushSubscription,
  maskEndpoint,
  parseWebPushSubscription,
} from './push-subscription';

const VALID = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHabcdef123456',
  keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa', auth: 'tBHItJI5svbpez7KI4CCXg' },
};

describe('parseWebPushSubscription (브라우저 구독 검증)', () => {
  it('정상 구독을 통과시킨다', () => {
    expect(parseWebPushSubscription(VALID)).toEqual(VALID);
  });

  it('앞뒤 공백을 정리한다', () => {
    const parsed = parseWebPushSubscription({
      endpoint: `  ${VALID.endpoint}  `,
      keys: { p256dh: ` ${VALID.keys.p256dh} `, auth: ` ${VALID.keys.auth} ` },
    });
    expect(parsed).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['객체가 아닌 값', 'not-an-object'],
    ['endpoint 없음', { keys: VALID.keys }],
    ['endpoint 빈 문자열', { endpoint: '  ', keys: VALID.keys }],
    ['keys 없음', { endpoint: VALID.endpoint }],
    ['p256dh 없음', { endpoint: VALID.endpoint, keys: { auth: VALID.keys.auth } }],
    ['auth 없음', { endpoint: VALID.endpoint, keys: { p256dh: VALID.keys.p256dh } }],
  ])('%s → ValidationError', (_label, input) => {
    expect(() => parseWebPushSubscription(input)).toThrow(DomainError);
  });

  it('http/데이터 URL 등 https 가 아닌 endpoint 는 거부한다', () => {
    // 실제 푸시 서비스는 예외 없이 https 다. http 를 허용하면 SSRF 표적이 될 수 있다.
    expect(() =>
      parseWebPushSubscription({ endpoint: 'http://evil.local/push', keys: VALID.keys }),
    ).toThrow(DomainError);
    expect(() =>
      parseWebPushSubscription({ endpoint: 'not-a-url', keys: VALID.keys }),
    ).toThrow(DomainError);
  });

  it('비정상적으로 긴 endpoint 는 거부한다', () => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${'x'.repeat(2100)}`;
    expect(() => parseWebPushSubscription({ endpoint, keys: VALID.keys })).toThrow(DomainError);
  });

  it('isWebPushSubscription 은 예외 대신 boolean 을 준다(DB 의 깨진 행 걸러내기)', () => {
    expect(isWebPushSubscription(VALID)).toBe(true);
    expect(isWebPushSubscription(null)).toBe(false);
    // sms/email 동의처럼 push_subscription_json 이 비어 있는 과거 행.
    expect(isWebPushSubscription({ endpoint: null, keys: null })).toBe(false);
  });
});

describe('maskEndpoint (발송 이력에 남길 수신자 마스킹)', () => {
  it('endpoint 원문이 이력에 남지 않는다', () => {
    // endpoint 는 그 자체가 "이 사용자에게 푸시를 보낼 권한"이라 민감정보다.
    const masked = maskEndpoint(VALID.endpoint);
    expect(masked).not.toContain('dQw4w9WgXcQ');
    expect(masked).not.toBe(VALID.endpoint);
  });

  it('어느 푸시 서비스인지(호스트)와 꼬리 몇 자는 남긴다(운영 추적용)', () => {
    expect(maskEndpoint(VALID.endpoint)).toBe('https://fcm.googleapis.com/***123456');
  });

  it('같은 사용자의 다른 기기 구독은 서로 다르게 마스킹된다', () => {
    const a = maskEndpoint('https://fcm.googleapis.com/fcm/send/aaaaaa111111');
    const b = maskEndpoint('https://fcm.googleapis.com/fcm/send/bbbbbb222222');
    expect(a).not.toBe(b);
  });

  it('recipient 컬럼(VARCHAR 255) 을 넘지 않는다', () => {
    const long = `https://updates.push.services.mozilla.com/wpush/v2/${'z'.repeat(1500)}`;
    expect(maskEndpoint(long).length).toBeLessThanOrEqual(255);
  });

  it('URL 이 아닌 깨진 값도 마스킹해서 돌려준다(예외를 던지지 않는다)', () => {
    // 이력 기록이 예외로 실패하면 발송 자체가 막힌다. 마스킹은 항상 성공해야 한다.
    const masked = maskEndpoint('garbage-value-987654');
    expect(masked).toBe('***987654');
  });
});
