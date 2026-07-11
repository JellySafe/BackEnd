import { Inject, Injectable } from '@nestjs/common';
import { Id } from '@shared/kernel/id';
import { NotFoundError } from '@shared/kernel/domain-error';
import { BeachDetail, GetBeachUseCase, toBeachDetail } from '../port/in/beach-use-cases';
import { BeachRepositoryPort, BEACH_REPOSITORY } from '../port/out/beach-repository.port';

/**
 * GET /public/beaches/:beachId 해변 마스터 단건 조회.
 * 위험도 상세는 risk 컨텍스트가 담당하고, 여기선 마스터 정보만 반환한다.
 */
@Injectable()
export class GetBeachService implements GetBeachUseCase {
  constructor(@Inject(BEACH_REPOSITORY) private readonly repository: BeachRepositoryPort) {}

  async get(beachId: Id): Promise<BeachDetail> {
    const beach = await this.repository.findById(beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', { beachId });
    }
    return toBeachDetail(beach);
  }
}
