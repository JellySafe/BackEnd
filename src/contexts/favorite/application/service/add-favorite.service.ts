import { Inject, Injectable } from '@nestjs/common';
import {
  AddFavoriteCommand,
  AddFavoriteResult,
  AddFavoriteUseCase,
} from '../port/in/favorite-use-cases';
import {
  FavoriteRepositoryPort,
  FAVORITE_REPOSITORY,
} from '../port/out/favorite-repository.port';
import { FavoriteBeach } from '../../domain/favorite-beach';

/**
 * USR-003 관심 해변 저장.
 * 소유자(userId|userToken) 불변식은 도메인이 검증하고,
 * 중복(uk) 은 리포지토리가 멱등 처리한다.
 */
@Injectable()
export class AddFavoriteService implements AddFavoriteUseCase {
  constructor(
    @Inject(FAVORITE_REPOSITORY) private readonly repository: FavoriteRepositoryPort,
  ) {}

  async add(command: AddFavoriteCommand): Promise<AddFavoriteResult> {
    const favorite = FavoriteBeach.create(command.owner, command.beachId);
    const saved = await this.repository.add(favorite);
    const s = saved.snapshot();
    return { favoriteId: s.id as number, beachId: s.beachId };
  }
}
