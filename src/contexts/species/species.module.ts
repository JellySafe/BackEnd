import { Module } from '@nestjs/common';
import { PublicSpeciesController } from './adapter/in/web/public-species.controller';
import { SpeciesKyselyQuery } from './adapter/out/persistence/species.kysely-query';
import { OccurrenceSpeciesKyselyQuery } from './adapter/out/persistence/occurrence-species.kysely-query';
import { ListSpeciesService } from './application/service/list-species.service';
import { ListCurrentSpeciesService } from './application/service/list-current-species.service';
import {
  LIST_CURRENT_SPECIES_USE_CASE,
  LIST_SPECIES_USE_CASE,
} from './application/port/in/species-use-cases';
import { SPECIES_QUERY } from './application/port/out/species-query.port';
import { OCCURRENCE_SPECIES_QUERY } from './application/port/out/occurrence-species-query.port';

/**
 * species 컨텍스트 (해파리 종 정보 / 도감).
 *
 * 담당 테이블: jellyfish_species.
 * 읽기 참조: jellyfish_occurrences (observation 이 쓰고, 여러 컨텍스트가 읽는다 —
 *            risk 컨텍스트도 risk-input.kysely-query 에서 직접 읽는 것과 같은 관례).
 *
 * ## 왜 beach 가 아니라 별도 컨텍스트인가
 * 종 정보는 **해변에 속하지 않는다.** 해변이 0개여도 종 도감은 성립하고, 종이 바뀌어도
 * 해변 마스터는 그대로다(수명주기가 다르다). beach 컨텍스트는 "해수욕장 마스터 + 그 화면에
 * 붙는 문구/권고" 를 담당한다. 종 분류학은 그 경계 밖의 독립 참조 데이터라 컨텍스트를 나눴다.
 *
 * 다른 컨텍스트가 "지금 출현 중인 종" 을 쓸 수 있도록 조회 유스케이스를 exports 로 노출한다.
 */
@Module({
  controllers: [PublicSpeciesController],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: LIST_SPECIES_USE_CASE, useClass: ListSpeciesService },
    { provide: LIST_CURRENT_SPECIES_USE_CASE, useClass: ListCurrentSpeciesService },
    // 아웃바운드 포트 → 어댑터
    { provide: SPECIES_QUERY, useClass: SpeciesKyselyQuery },
    { provide: OCCURRENCE_SPECIES_QUERY, useClass: OccurrenceSpeciesKyselyQuery },
  ],
  exports: [LIST_SPECIES_USE_CASE, LIST_CURRENT_SPECIES_USE_CASE],
})
export class SpeciesModule {}
