import { RATE_LIMIT, buildThrottlers, isCostlyRoute, isRateLimitExcluded } from './rate-limit.config';

describe('rate-limit.config', () => {
  describe('isRateLimitExcluded', () => {
    it('배치(/system/*)와 헬스체크는 제외한다 — 막히면 배치·로드밸런서가 죽는다', () => {
      expect(isRateLimitExcluded('/api/system/risk/calculate')).toBe(true);
      expect(isRateLimitExcluded('/api/system/observations/sync')).toBe(true);
      expect(isRateLimitExcluded('/api/health')).toBe(true);
      expect(isRateLimitExcluded('/api/health/ready')).toBe(true);
      expect(isRateLimitExcluded('/api/docs')).toBe(true);
    });

    it('공개/관리자 API 는 제외하지 않는다', () => {
      expect(isRateLimitExcluded('/api/public/reports')).toBe(false);
      expect(isRateLimitExcluded('/api/public/beaches')).toBe(false);
      expect(isRateLimitExcluded('/api/admin/reports')).toBe(false);
    });
  });

  describe('isCostlyRoute', () => {
    it('제보 접수와 이미지 업로드(POST)에만 엄격 리밋을 건다', () => {
      expect(isCostlyRoute('POST', '/api/public/reports')).toBe(true);
      expect(isCostlyRoute('POST', '/api/public/reports/image')).toBe(true);
    });

    it('조회는 엄격 리밋 대상이 아니다', () => {
      expect(isCostlyRoute('GET', '/api/public/reports/12')).toBe(false);
      expect(isCostlyRoute('GET', '/api/public/reports')).toBe(false);
    });

    it('다른 쓰기 경로는 기본 리밋만 탄다', () => {
      expect(isCostlyRoute('POST', '/api/admin/reports/1/review')).toBe(false);
      expect(isCostlyRoute('POST', '/api/public/favorites')).toBe(false);
    });
  });

  it('엄격 리밋이 기본 리밋보다 실제로 더 엄격하다', () => {
    expect(RATE_LIMIT.REPORT_BURST.limit).toBeLessThan(RATE_LIMIT.DEFAULT.limit);
    expect(RATE_LIMIT.REPORT_HOURLY.ttl).toBeGreaterThan(RATE_LIMIT.REPORT_BURST.ttl);
  });
});

describe('한도 설정', () => {
  it('설정이 없으면 기본값 그대로다 — 아무것도 안 바꾼 환경은 지금과 똑같이 동작해야 한다', () => {
    const throttlers = buildThrottlers({});
    expect(throttlers.map((t) => t.limit)).toEqual([300, 10, 60]);
  });

  it('설정한 값으로 바뀐다 — 급증 때 재배포 없이 조정할 수 있어야 한다', () => {
    const throttlers = buildThrottlers({
      defaultPerMin: '5000',
      reportPerMin: '30',
      reportPerHour: '200',
    });
    expect(throttlers.map((t) => t.limit)).toEqual([5000, 30, 200]);
  });

  it.each(['0', '-1', 'abc', '', '1.5'])(
    '쓸 수 없는 값 %p 은 기본값으로 되돌린다 — 오타로 리밋이 사라지면 안 된다',
    (value) => {
      expect(buildThrottlers({ defaultPerMin: value })[0].limit).toBe(300);
    },
  );

  it('창(ttl)은 설정으로 바꾸지 않는다 — 분당/시간당이라는 의미가 흔들린다', () => {
    const throttlers = buildThrottlers({ defaultPerMin: '5000' });
    expect(throttlers[0].ttl).toBe(60_000);
    expect(throttlers[2].ttl).toBe(3_600_000);
  });

  it('이름은 그대로다 — 이름으로 버킷을 묶으므로 바뀌면 제보 리밋이 갈라진다', () => {
    expect(buildThrottlers({ defaultPerMin: '999' }).map((t) => t.name)).toEqual([
      'default',
      'report-burst',
      'report-hourly',
    ]);
  });
});
