import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '@shared/kernel/domain-error';
import {
  BeachDetail,
  UpdateBeachCommand,
  UpdateBeachUseCase,
  toBeachDetail,
} from '../port/in/beach-use-cases';
import { BeachRepositoryPort, BEACH_REPOSITORY } from '../port/out/beach-repository.port';

/**
 * ADM-005 해변 수정. 애그리거트를 복원 → 병합 검증(applyUpdate) → 저장한다.
 */
@Injectable()
export class UpdateBeachService implements UpdateBeachUseCase {
  constructor(@Inject(BEACH_REPOSITORY) private readonly repository: BeachRepositoryPort) {}

  async update(command: UpdateBeachCommand): Promise<BeachDetail> {
    const beach = await this.repository.findById(command.beachId);
    if (!beach) {
      throw new NotFoundError('BEACH_NOT_FOUND', '해변을 찾을 수 없습니다.', {
        beachId: command.beachId,
      });
    }
    beach.applyUpdate({
      name: command.name,
      region: command.region,
      lat: command.lat,
      lng: command.lng,
      facingDirection: command.facingDirection,
      priority: command.priority,
      vulnerabilityScore: command.vulnerabilityScore,
      isActive: command.isActive,
    });
    const saved = await this.repository.update(beach);
    return toBeachDetail(saved);
  }
}
