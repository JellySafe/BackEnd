import { Inject, Injectable } from '@nestjs/common';
import { StaticGuideView } from '../../domain/static-guide';
import { ListGuidesUseCase } from '../port/in/beach-use-cases';
import { GuideListFilter, GuideQueryPort, GUIDE_QUERY } from '../port/out/guide-query.port';

/**
 * G-006 안내/고지 문구 조회. 활성 문구를 displayOrder 순으로 반환한다.
 */
@Injectable()
export class ListGuidesService implements ListGuidesUseCase {
  constructor(@Inject(GUIDE_QUERY) private readonly query: GuideQueryPort) {}

  list(filter: GuideListFilter): Promise<StaticGuideView[]> {
    return this.query.list(filter);
  }
}
