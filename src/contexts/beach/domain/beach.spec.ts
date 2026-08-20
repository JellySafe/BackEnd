import { DomainError } from '@shared/kernel/domain-error';
import { Beach, NewBeachInput } from './beach';

/**
 * 해변 마스터 (ADM-005).
 *
 * 여기서 지키는 것은 **좌표의 물리적 유효성**이다. 해변 좌표는 단순한 표시 데이터가 아니다 —
 * 제보의 최근접 해변 배정(nearest-beach), 인근 출현 반경 판정(30km), 감시 해역 포함 여부가
 * 전부 이 값에서 나온다. 위경도가 뒤바뀌거나 범위를 벗어난 값이 들어오면 그 해변은
 * 조용히 엉뚱한 곳의 데이터로 위험도를 매기게 된다.
 */
describe('Beach', () => {
  const valid: NewBeachInput = {
    name: '협재해수욕장',
    region: '제주시',
    lat: 33.3941,
    lng: 126.2396,
  };

  describe('등록', () => {
    it('유효한 입력이면 만들어진다', () => {
      const beach = Beach.create(valid);
      expect(beach.name).toBe('협재해수욕장');
      expect(beach.isActive).toBe(true);
    });

    it('이름과 지역의 앞뒤 공백을 정리한다', () => {
      const beach = Beach.create({ ...valid, name: '  협재해수욕장  ', region: ' 제주시 ' });
      expect(beach.snapshot().name).toBe('협재해수욕장');
      expect(beach.snapshot().region).toBe('제주시');
    });

    it('공백만 있는 이름은 없는 것으로 본다', () => {
      expect(() => Beach.create({ ...valid, name: '   ' })).toThrow(/이름/);
    });

    it('우선순위를 안 주면 기본값(99)으로 뒤에 놓인다', () => {
      expect(Beach.create(valid).snapshot().priority).toBe(99);
    });

    it('방위각을 안 주면 null 이다 — 모르는 값을 0(정북)으로 채우지 않는다', () => {
      // 0 으로 채우면 "정북을 향한 해변" 이 되어 유입 풍향/해류 점수가 실제로 매겨진다.
      expect(Beach.create(valid).snapshot().facingDirection).toBeNull();
    });

    it('빈 문자열 사진 URL 은 null 로 접는다', () => {
      expect(Beach.create({ ...valid, imageUrl: '  ' }).snapshot().imageUrl).toBeNull();
    });
  });

  describe('좌표 범위', () => {
    it.each([
      ['위도 하한 초과', { lat: -90.1 }],
      ['위도 상한 초과', { lat: 90.1 }],
      ['위도가 NaN', { lat: Number.NaN }],
      ['위도가 무한대', { lat: Number.POSITIVE_INFINITY }],
    ])('%s 는 거부한다', (_label, patch) => {
      expect(() => Beach.create({ ...valid, ...patch })).toThrow(DomainError);
    });

    it.each([
      ['경도 하한 초과', { lng: -180.1 }],
      ['경도 상한 초과', { lng: 180.1 }],
      ['경도가 NaN', { lng: Number.NaN }],
    ])('%s 는 거부한다', (_label, patch) => {
      expect(() => Beach.create({ ...valid, ...patch })).toThrow(DomainError);
    });

    it.each([
      [-90, -180],
      [90, 180],
      [0, 0],
    ])('경계값 (%p, %p) 은 허용한다', (lat, lng) => {
      expect(() => Beach.create({ ...valid, lat, lng })).not.toThrow();
    });

    it('거부 사유에 문제가 된 값을 담는다 — 로그만 보고 원인을 알 수 있어야 한다', () => {
      try {
        Beach.create({ ...valid, lat: 100 });
        throw new Error('막았어야 한다');
      } catch (error) {
        expect((error as DomainError).code).toBe('BEACH_LAT_RANGE');
        expect((error as DomainError).details).toEqual({ lat: 100 });
      }
    });
  });

  describe('방위각', () => {
    it.each([0, 180, 359])('%i 는 허용한다', (direction) => {
      expect(() => Beach.create({ ...valid, facingDirection: direction })).not.toThrow();
    });

    it.each([-1, 360, 45.5])('%p 는 거부한다 — 방위각은 0~359 정수다', (direction) => {
      expect(() => Beach.create({ ...valid, facingDirection: direction })).toThrow(
        /방위각/,
      );
    });

    it('null 은 "모름" 이므로 허용한다', () => {
      expect(() => Beach.create({ ...valid, facingDirection: null })).not.toThrow();
    });
  });

  describe('우선순위', () => {
    it.each([-1, 1.5])('%p 는 거부한다 — 0 이상의 정수여야 한다', (priority) => {
      expect(() => Beach.create({ ...valid, priority })).toThrow(/우선순위/);
    });

    it('0 은 허용한다 — 가장 먼저 노출하겠다는 뜻이다', () => {
      expect(Beach.create({ ...valid, priority: 0 }).snapshot().priority).toBe(0);
    });
  });

  describe('사진 URL', () => {
    it('500자까지 허용한다', () => {
      const url = `https://x/${'a'.repeat(500 - 10)}`;
      expect(() => Beach.create({ ...valid, imageUrl: url })).not.toThrow();
    });

    it('500자를 넘으면 거부한다 — DB 컬럼이 VARCHAR(500) 이라 넘기면 잘린다', () => {
      expect(() => Beach.create({ ...valid, imageUrl: 'a'.repeat(501) })).toThrow(/500자/);
    });
  });

  describe('수정', () => {
    it('준 필드만 바꾸고 나머지는 그대로 둔다', () => {
      const beach = Beach.create(valid);
      beach.applyUpdate({ name: '금능해수욕장' });

      const snapshot = beach.snapshot();
      expect(snapshot.name).toBe('금능해수욕장');
      expect(snapshot.region).toBe('제주시');
      expect(snapshot.lat).toBe(valid.lat);
    });

    it('수정에서도 좌표 범위를 다시 본다 — 등록만 검사하면 수정으로 우회된다', () => {
      const beach = Beach.create(valid);
      expect(() => beach.applyUpdate({ lat: 999 })).toThrow(/위도/);
    });

    it('검증에 걸리면 아무것도 바뀌지 않는다 — 절반만 반영된 상태를 남기지 않는다', () => {
      const beach = Beach.create(valid);
      expect(() => beach.applyUpdate({ name: '새 이름', lat: 999 })).toThrow();
      expect(beach.snapshot().name).toBe('협재해수욕장');
    });

    it('비활성으로 내릴 수 있다', () => {
      const beach = Beach.create(valid);
      beach.applyUpdate({ isActive: false });
      expect(beach.isActive).toBe(false);
    });

    it('방위각을 null 로 되돌릴 수 있다 — 잘못 넣은 값을 "모름" 으로 지울 수 있어야 한다', () => {
      const beach = Beach.create({ ...valid, facingDirection: 180 });
      beach.applyUpdate({ facingDirection: null });
      expect(beach.snapshot().facingDirection).toBeNull();
    });
  });

  describe('복원', () => {
    it('저장소에서 온 값은 검증 없이 그대로 재구성한다', () => {
      // 이미 저장된 행을 되살리는 경로다. 여기서 던지면 과거 데이터 때문에 조회가 통째로
      // 막힌다 — 규칙이 바뀌었을 때 읽기까지 멎으면 안 된다.
      const beach = Beach.reconstitute({
        id: 1,
        name: '옛 해변',
        region: '제주시',
        lat: 999,
        lng: 999,
        facingDirection: null,
        priority: 0,
        imageUrl: null,
        isActive: true,
      });
      expect(beach.id).toBe(1);
    });
  });

  describe('스냅샷', () => {
    it('복사본을 준다 — 밖에서 고쳐도 애그리거트가 바뀌지 않는다', () => {
      const beach = Beach.create(valid);
      const snapshot = beach.snapshot() as { name: string };
      snapshot.name = '조작된 이름';
      expect(beach.name).toBe('협재해수욕장');
    });
  });
});
