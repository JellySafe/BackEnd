import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { GetBeachSubscribersUseCase } from '../port/in/favorite-use-cases';
import {
  BeachSubscriber,
  FavoriteQueryPort,
  FAVORITE_QUERY,
} from '../port/out/favorite-query.port';

/**
 * 특정 해변을 관심 등록한 사용자 목록 조회.
 * SYS-005 위험 상승·독성·쏘임 발생 시 관심 해변 사용자에게 알림을 확산하기 위해
 * notification 컨텍스트가 이 유스케이스를 주입해 사용한다.
 */
@Injectable()
export class GetBeachSubscribersService implements GetBeachSubscribersUseCase {
  constructor(@Inject(FAVORITE_QUERY) private readonly query: FavoriteQueryPort) {}

  getSubscribers(beachId: Id): Promise<BeachSubscriber[]> {
    return this.query.findSubscribers(beachId);
  }
}
