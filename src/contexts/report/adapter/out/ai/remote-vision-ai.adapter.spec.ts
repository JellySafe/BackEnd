import { ConfigService } from '@nestjs/config';
import { RemoteVisionAiAdapter } from './remote-vision-ai.adapter';

/**
 * 원격 Vision 모델 어댑터 (SYS-004).
 *
 * ⚠️ 실제 모델 서버로는 검증하지 못했다(학습된 모델과 서빙 환경이 필요하다). 그래서 **우리가
 * 통제하는 부분**을 고정한다: 요청 형태, 응답 해석, 계약 밖 값의 처리, 실패 전파.
 *
 * 특히 "실패를 normal 로 떨어뜨리지 않는다" 를 못 박는다 — 판별 실패와 "정상으로 판별됨" 은
 * 안전 서비스에서 완전히 다른 상태이고, 후자로 잘못 기록되면 아무도 다시 보지 않는다.
 */
describe('RemoteVisionAiAdapter', () => {
  const originalFetch = global.fetch;
  const CONFIG = {
    VISION_AI_MODE: 'remote',
    VISION_AI_ENDPOINT: 'https://vision.example.com/classify',
    VISION_AI_API_KEY: 'secret-key',
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function build(config: Record<string, string> = CONFIG): RemoteVisionAiAdapter {
    const adapter = new RemoteVisionAiAdapter(new ConfigService(config));
    jest.spyOn(adapter['logger'], 'error').mockImplementation(() => undefined);
    return adapter;
  }

  function mockJson(status: number, payload: unknown): jest.Mock {
    const fn = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
    });
    global.fetch = fn;
    return fn;
  }

  it('이미지 URL 을 보내고 인증 헤더를 붙인다', async () => {
    const fetchMock = mockJson(200, { result: 'normal', confidence: 0.9 });

    await build().classify({ imageUrl: '/uploads/a.jpg' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://vision.example.com/classify');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(init.body as string)).toEqual({ imageUrl: '/uploads/a.jpg' });
  });

  it('키가 없으면 인증 헤더를 붙이지 않는다', async () => {
    const fetchMock = mockJson(200, { result: 'normal' });

    await build({ ...CONFIG, VISION_AI_API_KEY: '' }).classify({ imageUrl: '/uploads/a.jpg' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('모델이 알려준 이름·버전을 그대로 기록한다 (설정값을 쓰면 모델 교체를 놓친다)', async () => {
    mockJson(200, {
      result: 'toxic_suspected',
      confidence: 0.8712,
      modelName: 'jelly-vit',
      modelVersion: '1.2.0',
    });

    const res = await build().classify({ imageUrl: '/uploads/a.jpg' });

    expect(res).toMatchObject({
      result: 'toxic_suspected',
      confidence: 0.8712,
      modelName: 'jelly-vit',
      modelVersion: '1.2.0',
    });
  });

  it('계약 밖 판별값은 unknown 으로 접는다 — 모르는 값을 아는 척하지 않는다', async () => {
    mockJson(200, { result: 'DANGEROUS_CONFIRMED', confidence: 0.99 });

    expect((await build().classify({ imageUrl: '/a.jpg' })).result).toBe('unknown');
  });

  it('신뢰도가 범위 밖이거나 없으면 null — 가짜 확신을 만들지 않는다', async () => {
    for (const confidence of [undefined, -0.1, 1.5, 'high']) {
      mockJson(200, { result: 'normal', confidence });
      expect((await build().classify({ imageUrl: '/a.jpg' })).confidence).toBeNull();
    }
  });

  it('신뢰도는 DECIMAL(5,4) 에 맞춰 잘라 낸다', async () => {
    mockJson(200, { result: 'normal', confidence: 0.123456789 });

    expect((await build().classify({ imageUrl: '/a.jpg' })).confidence).toBe(0.1235);
  });

  it('서버 오류는 예외로 올린다 — 판별 실패가 "정상 판별" 로 둔갑하면 안 된다', async () => {
    mockJson(503, {});

    await expect(build().classify({ imageUrl: '/a.jpg' })).rejects.toThrow('HTTP 503');
  });

  it('응답이 객체가 아니면 예외', async () => {
    mockJson(200, 'ok');

    await expect(build().classify({ imageUrl: '/a.jpg' })).rejects.toThrow();
  });

  it('네트워크 오류도 그대로 올린다', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    await expect(build().classify({ imageUrl: '/a.jpg' })).rejects.toThrow('timeout');
  });
});
