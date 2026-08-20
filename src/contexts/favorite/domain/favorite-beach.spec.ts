import { DomainError } from '@shared/kernel/domain-error';
import { FavoriteBeach, normalizeOwner } from './favorite-beach';

/**
 * 관심 해변 (USR-003).
 *
 * 가벼워 보이지만 **안전 알림의 발송 대상 목록**이다. 소유자가 비면 그 등록은 아무에게도
 * 닿지 않는 유령 행이 되고, 반대로 남의 소유자로 등록되면 그 사람의 알림함이 오염된다.
 * 그래서 "소유자 없이는 만들어지지 않는다" 를 도메인이 직접 막는다.
 *
 * (신원 자체가 위조되지 않는 것은 상위 계층의 책임이다 — 서명된 게스트 토큰과 JWT 에서만
 *  소유자가 나온다. 여기서는 그 값이 비어 있지 않은지를 본다)
 */
describe('FavoriteBeach', () => {
  describe('소유자 정규화', () => {
    it('로그인 사용자만 있어도 통과한다', () => {
      expect(normalizeOwner({ userId: 7, userToken: null })).toEqual({
        userId: 7,
        userToken: null,
      });
    });

    it('게스트 토큰만 있어도 통과한다', () => {
      expect(normalizeOwner({ userId: null, userToken: 'guest-abc' })).toEqual({
        userId: null,
        userToken: 'guest-abc',
      });
    });

    it('토큰의 앞뒤 공백을 정리한다 — 같은 사람이 두 소유자로 갈라지면 안 된다', () => {
      expect(normalizeOwner({ userId: null, userToken: '  guest-abc  ' }).userToken).toBe(
        'guest-abc',
      );
    });

    it('공백만 있는 토큰은 없는 것으로 본다', () => {
      expect(() => normalizeOwner({ userId: null, userToken: '   ' })).toThrow(DomainError);
    });

    it('둘 다 없으면 거부한다 — 주인 없는 관심 해변은 알림이 닿지 않는 유령 행이다', () => {
      expect(() => normalizeOwner({ userId: null, userToken: null })).toThrow(
        /userId.*userToken|로그인/,
      );
    });

    it.each([0, -1])('userId %p 는 없는 것으로 본다 — 0 은 식별자가 아니다', (userId) => {
      expect(() => normalizeOwner({ userId, userToken: null })).toThrow(DomainError);
    });

    it('둘 다 있으면 둘 다 남긴다 — 로그인 전후를 잇는 판단은 상위 계층 몫이다', () => {
      expect(normalizeOwner({ userId: 7, userToken: 'guest-abc' })).toEqual({
        userId: 7,
        userToken: 'guest-abc',
      });
    });
  });

  describe('등록', () => {
    it('소유자와 해변이 있으면 만들어진다', () => {
      const favorite = FavoriteBeach.create({ userId: 7, userToken: null }, 3);
      expect(favorite.userId).toBe(7);
      expect(favorite.beachId).toBe(3);
      expect(favorite.userToken).toBeNull();
    });

    it.each([0, -1])('해변 식별자 %p 는 거부한다', (beachId) => {
      expect(() => FavoriteBeach.create({ userId: 7, userToken: null }, beachId)).toThrow(
        /해변 식별자/,
      );
    });

    it('소유자가 없으면 해변이 유효해도 거부한다', () => {
      expect(() => FavoriteBeach.create({ userId: null, userToken: null }, 3)).toThrow(
        DomainError,
      );
    });

    it('토큰 공백은 정리해서 저장한다', () => {
      const favorite = FavoriteBeach.create({ userId: null, userToken: ' t ' }, 3);
      expect(favorite.userToken).toBe('t');
    });

    it('신규 등록에는 아직 id 가 없다 — 저장소가 채운다', () => {
      expect(FavoriteBeach.create({ userId: 7, userToken: null }, 3).id).toBeUndefined();
    });
  });

  describe('복원', () => {
    it('저장된 행은 검증 없이 재구성한다', () => {
      const favorite = FavoriteBeach.reconstitute({
        id: 11,
        userId: null,
        userToken: null,
        beachId: 3,
      });
      expect(favorite.id).toBe(11);
    });
  });

  describe('스냅샷', () => {
    it('복사본을 준다', () => {
      const favorite = FavoriteBeach.create({ userId: 7, userToken: null }, 3);
      const snapshot = favorite.snapshot() as { beachId: number };
      snapshot.beachId = 999;
      expect(favorite.beachId).toBe(3);
    });
  });
});
