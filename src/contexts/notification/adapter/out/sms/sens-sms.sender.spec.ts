import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { SensSmsSender, signRequest } from './sens-sms.sender';
import { DisabledSmsSender } from './disabled-sms.sender';

/**
 * SENS 발송 어댑터.
 *
 * ⚠️ 실제 사업자 계정으로는 검증하지 못했다(계약 + 발신번호 사전등록이 필요하다).
 * 그래서 **우리가 통제하는 부분**을 고정한다: 서명 계산, 요청 형태, 응답 코드 해석.
 * 서명이 틀리면 모든 발송이 401 로 실패하는데 응답만 봐서는 원인을 알기 어렵다.
 */

const CONFIG = {
  SMS_PROVIDER: 'sens',
  SENS_SERVICE_ID: 'ncp:sms:kr:123:jellysafe',
  SENS_ACCESS_KEY: 'ACCESS',
  SENS_SECRET_KEY: 'SECRET',
  SENS_FROM: '0641234567',
};

describe('SENS 서명(v2)', () => {
  it('사업자 문서의 서명 규칙을 그대로 따른다', () => {
    const path = '/sms/v2/services/svc/messages';
    const expected = createHmac('sha256', 'SECRET')
      .update('POST /sms/v2/services/svc/messages\n1755648000000\nACCESS', 'utf8')
      .digest('base64');

    expect(signRequest(path, '1755648000000', 'ACCESS', 'SECRET')).toBe(expected);
  });

  it('타임스탬프가 다르면 서명도 달라진다 (재사용 불가)', () => {
    const a = signRequest('/p', '1', 'ACCESS', 'SECRET');
    const b = signRequest('/p', '2', 'ACCESS', 'SECRET');
    expect(a).not.toBe(b);
  });
});

describe('SensSmsSender', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function build(config: Record<string, string> = CONFIG) {
    const sender = new SensSmsSender(new ConfigService(config));
    jest.spyOn(sender['logger'], 'warn').mockImplementation(() => undefined);
    return sender;
  }

  function mockFetch(status: number, body = ''): jest.Mock {
    const fn = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
    global.fetch = fn;
    return fn;
  }

  it('설정이 갖춰지면 활성 상태다', () => {
    expect(build().isEnabled()).toBe(true);
  });

  it('설정이 하나라도 비면 비활성 — 부분 설정으로 켜지면 발송마다 401 이 난다', () => {
    expect(build({ ...CONFIG, SENS_FROM: '' }).isEnabled()).toBe(false);
    expect(build({ ...CONFIG, SENS_SECRET_KEY: '' }).isEnabled()).toBe(false);
  });

  it('비활성 상태에서 보내면 skipped (예외를 던지지 않는다)', async () => {
    const outcome = await build({ ...CONFIG, SENS_FROM: '' }).send({ to: '01012345678', body: 'x' });
    expect(outcome.status).toBe('skipped');
  });

  it('사업자 형식대로 요청한다 (서명 헤더 3종 + 발신번호 + 수신자)', async () => {
    const fetchMock = mockFetch(202, '{"statusCode":"202"}');

    await build().send({ to: '01012345678', body: '위험 경보' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://sens.apigw.ntruss.com/sms/v2/services/ncp:sms:kr:123:jellysafe/messages',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['x-ncp-iam-access-key']).toBe('ACCESS');
    expect(headers['x-ncp-apigw-signature-v2']).toEqual(expect.any(String));
    // 서명에 쓴 타임스탬프와 헤더 값이 같아야 한다(다르면 사업자가 401 을 준다).
    const timestamp = headers['x-ncp-apigw-timestamp'];
    expect(headers['x-ncp-apigw-signature-v2']).toBe(
      signRequest('/sms/v2/services/ncp:sms:kr:123:jellysafe/messages', timestamp, 'ACCESS', 'SECRET'),
    );

    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload.from).toBe('0641234567');
    expect(payload.content).toBe('위험 경보');
    expect(payload.messages).toEqual([{ to: '01012345678' }]);
  });

  it('2xx 는 접수(sent)', async () => {
    mockFetch(202);
    expect((await build().send({ to: '01012345678', body: 'x' })).status).toBe('sent');
  });

  it('4xx 는 영구 거부(rejected) — 재시도해도 같은 결과다', async () => {
    mockFetch(400, '발신번호가 등록되지 않았습니다');
    const outcome = await build().send({ to: '01012345678', body: 'x' });

    expect(outcome.status).toBe('rejected');
    expect(outcome.failedReason).toContain('발신번호');
  });

  it('429 는 일시 실패(failed) — 4xx 지만 "잠시 뒤 다시" 라는 뜻이다', async () => {
    mockFetch(429);
    expect((await build().send({ to: '01012345678', body: 'x' })).status).toBe('failed');
  });

  it('5xx 는 일시 실패(failed)', async () => {
    mockFetch(503);
    expect((await build().send({ to: '01012345678', body: 'x' })).status).toBe('failed');
  });

  it('네트워크 오류도 일시 실패로 본다 (예외를 던지지 않는다)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const outcome = await build().send({ to: '01012345678', body: 'x' });

    expect(outcome.status).toBe('failed');
    expect(outcome.statusCode).toBeNull();
  });

  it('실패 로그에 번호 원문을 남기지 않는다', async () => {
    mockFetch(400, 'bad');
    const sender = build();
    const warn = jest.spyOn(sender['logger'], 'warn').mockImplementation(() => undefined);

    await sender.send({ to: '01012345678', body: 'x' });

    expect(warn.mock.calls[0][0]).toContain('010-****-5678');
    expect(warn.mock.calls[0][0]).not.toContain('01012345678');
  });
});

describe('DisabledSmsSender', () => {
  it('보내지 않고 skipped 로 답한다 — 미설정은 고장이 아니다', async () => {
    const sender = new DisabledSmsSender();
    expect(sender.isEnabled()).toBe(false);
    expect((await sender.send()).status).toBe('skipped');
  });
});
