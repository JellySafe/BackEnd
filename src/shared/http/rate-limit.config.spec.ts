import { RATE_LIMIT, isCostlyRoute, isRateLimitExcluded } from './rate-limit.config';

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
