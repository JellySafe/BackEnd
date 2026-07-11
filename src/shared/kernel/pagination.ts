/**
 * 페이지네이션 공용 값 객체.
 */
export interface PageRequest {
  readonly page: number; // 1-base
  readonly size: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
  readonly totalPages: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 20;
export const MAX_SIZE = 100;

export function normalizePageRequest(page?: number, size?: number): PageRequest {
  const p = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : DEFAULT_PAGE;
  const rawSize = Number.isFinite(size) && (size as number) > 0 ? Math.floor(size as number) : DEFAULT_SIZE;
  return { page: p, size: Math.min(rawSize, MAX_SIZE) };
}

export function toPage<T>(items: T[], total: number, req: PageRequest): Page<T> {
  return {
    items,
    total,
    page: req.page,
    size: req.size,
    totalPages: req.size > 0 ? Math.ceil(total / req.size) : 0,
  };
}

/** SQL OFFSET 계산 */
export function offsetOf(req: PageRequest): number {
  return (req.page - 1) * req.size;
}
