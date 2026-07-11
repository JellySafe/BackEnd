import { Inject, Injectable } from '@nestjs/common';
import {
  RemoveFavoriteCommand,
  RemoveFavoriteUseCase,
} from '../port/in/favorite-use-cases';
import {
  FavoriteRepositoryPort,
  FAVORITE_REPOSITORY,
} from '../port/out/favorite-repository.port';
import { normalizeOwner } from '../../domain/favorite-beach';

/**
 * 관심 해변 해제. 없어도 오류 없이 멱등하게 처리한다.
 */
@Injectable()
export class RemoveFavoriteService implements RemoveFavoriteUseCase {
  constructor(
    @Inject(FAVORITE_REPOSITORY) private readonly repository: FavoriteRepositoryPort,
  ) {}

  async remove(command: RemoveFavoriteCommand): Promise<void> {
    const owner = normalizeOwner(command.owner);
    await this.repository.remove(owner, command.beachId);
  }
}
