import { Inject, Injectable } from '@nestjs/common';
import { Beach } from '../../domain/beach';
import {
  BeachDetail,
  CreateBeachCommand,
  CreateBeachUseCase,
  toBeachDetail,
} from '../port/in/beach-use-cases';
import { BeachRepositoryPort, BEACH_REPOSITORY } from '../port/out/beach-repository.port';

/**
 * ADM-005 해변 등록. 도메인 불변식(좌표/방위 범위)은 Beach.create 가 강제한다.
 */
@Injectable()
export class CreateBeachService implements CreateBeachUseCase {
  constructor(@Inject(BEACH_REPOSITORY) private readonly repository: BeachRepositoryPort) {}

  async create(command: CreateBeachCommand): Promise<BeachDetail> {
    const beach = Beach.create({
      name: command.name,
      region: command.region,
      lat: command.lat,
      lng: command.lng,
      facingDirection: command.facingDirection ?? null,
      priority: command.priority,
      imageUrl: command.imageUrl ?? null,
    });
    const saved = await this.repository.save(beach);
    return toBeachDetail(saved);
  }
}
