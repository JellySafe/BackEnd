import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  MAX_SIZE,
  normalizePageRequest,
  offsetOf,
  toPage,
} from './pagination';

describe('pagination', () => {
  describe('normalizePageRequest', () => {
    it('인자 없으면 기본값 (page=1, size=20)', () => {
      expect(normalizePageRequest()).toEqual({ page: DEFAULT_PAGE, size: DEFAULT_SIZE });
    });

    it('page 0/음수는 기본 페이지로', () => {
      expect(normalizePageRequest(0, 10)).toEqual({ page: 1, size: 10 });
      expect(normalizePageRequest(-5, 10)).toEqual({ page: 1, size: 10 });
    });

    it('size 0/음수는 기본 사이즈로', () => {
      expect(normalizePageRequest(2, 0)).toEqual({ page: 2, size: DEFAULT_SIZE });
      expect(normalizePageRequest(2, -3)).toEqual({ page: 2, size: DEFAULT_SIZE });
    });

    it('size 가 MAX_SIZE 초과면 MAX_SIZE 로 clamp', () => {
      expect(normalizePageRequest(1, MAX_SIZE + 50).size).toBe(MAX_SIZE);
    });

    it('소수 입력은 floor 처리', () => {
      expect(normalizePageRequest(2.9, 15.7)).toEqual({ page: 2, size: 15 });
    });

    it('유효한 값은 그대로 통과', () => {
      expect(normalizePageRequest(3, 50)).toEqual({ page: 3, size: 50 });
    });
  });

  describe('offsetOf', () => {
    it('(page-1)*size 로 SQL OFFSET 계산', () => {
      expect(offsetOf({ page: 1, size: 20 })).toBe(0);
      expect(offsetOf({ page: 2, size: 20 })).toBe(20);
      expect(offsetOf({ page: 5, size: 10 })).toBe(40);
    });
  });

  describe('toPage', () => {
    it('totalPages = ceil(total/size)', () => {
      const page = toPage([1, 2, 3], 25, { page: 1, size: 10 });
      expect(page.totalPages).toBe(3);
      expect(page).toMatchObject({ items: [1, 2, 3], total: 25, page: 1, size: 10 });
    });

    it('total 이 size 배수면 나누어 떨어짐', () => {
      expect(toPage([], 20, { page: 1, size: 10 }).totalPages).toBe(2);
    });

    it('total 0 이면 totalPages 0', () => {
      expect(toPage([], 0, { page: 1, size: 10 }).totalPages).toBe(0);
    });
  });
});
