import { Id } from '@shared/kernel/id';
import { ValidationError } from '@shared/kernel/domain-error';

/**
 * 관심 해변 소유자 식별. MVP 는 비로그인(user_token) 또는 로그인(user_id).
 * 둘 중 하나는 반드시 있어야 한다(USR-003 불변식).
 */
export interface FavoriteOwner {
  userId: Id | null;
  userToken: string | null;
}

/** 소유자 불변식 검증 + 정규화(token 공백 제거). */
export function normalizeOwner(owner: FavoriteOwner): FavoriteOwner {
  const token = owner.userToken?.trim() ?? '';
  const userId = owner.userId ?? null;
  const hasUserId = userId !== null && userId > 0;
  const hasToken = token.length > 0;
  if (!hasUserId && !hasToken) {
    throw new ValidationError(
      'FAVORITE_OWNER_REQUIRED',
      '관심 해변 저장에는 로그인(userId) 또는 게스트 토큰(userToken)이 필요합니다.',
    );
  }
  return {
    userId: hasUserId ? userId : null,
    userToken: hasToken ? token : null,
  };
}

export interface FavoriteBeachProps {
  id?: Id;
  userId: Id | null;
  userToken: string | null;
  beachId: Id;
  createdAt?: Date;
}

/**
 * 관심 해변 값 애그리거트 (USR-003).
 * 소유자(user_id|user_token) 필수 불변식을 캡슐화한다. 가벼운 도메인.
 */
export class FavoriteBeach {
  private constructor(private props: FavoriteBeachProps) {}

  /** 신규 관심 등록. 소유자/해변 유효성 검증. */
  static create(owner: FavoriteOwner, beachId: Id): FavoriteBeach {
    if (!beachId || beachId <= 0) {
      throw new ValidationError('FAVORITE_BEACH_REQUIRED', '관심 해변 식별자가 필요합니다.');
    }
    const normalized = normalizeOwner(owner);
    return new FavoriteBeach({
      userId: normalized.userId,
      userToken: normalized.userToken,
      beachId,
    });
  }

  /** DB row 복원. */
  static reconstitute(props: FavoriteBeachProps): FavoriteBeach {
    return new FavoriteBeach(props);
  }

  get id(): Id | undefined {
    return this.props.id;
  }
  get userId(): Id | null {
    return this.props.userId;
  }
  get userToken(): string | null {
    return this.props.userToken;
  }
  get beachId(): Id {
    return this.props.beachId;
  }

  snapshot(): Readonly<FavoriteBeachProps> {
    return { ...this.props };
  }
}
