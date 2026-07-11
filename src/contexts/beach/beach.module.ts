import { Module } from '@nestjs/common';
import { PublicBeachController } from './adapter/in/web/public-beach.controller';
import { AdminBeachController } from './adapter/in/web/admin-beach.controller';
import { PublicGuideController } from './adapter/in/web/public-guide.controller';
import { AdminRecommendationController } from './adapter/in/web/admin-recommendation.controller';
import { BeachPrismaRepository } from './adapter/out/persistence/beach.prisma-repository';
import { BeachKyselyQuery } from './adapter/out/persistence/beach.kysely-query';
import { GuideKyselyQuery } from './adapter/out/persistence/guide.kysely-query';
import { RecommendationKyselyQuery } from './adapter/out/persistence/recommendation.kysely-query';
import { ListBeachesService } from './application/service/list-beaches.service';
import { GetBeachService } from './application/service/get-beach.service';
import { ListAdminBeachesService } from './application/service/list-admin-beaches.service';
import { CreateBeachService } from './application/service/create-beach.service';
import { UpdateBeachService } from './application/service/update-beach.service';
import { ListGuidesService } from './application/service/list-guides.service';
import { ListRecommendationsService } from './application/service/list-recommendations.service';
import { BEACH_REPOSITORY } from './application/port/out/beach-repository.port';
import { BEACH_QUERY } from './application/port/out/beach-query.port';
import { GUIDE_QUERY } from './application/port/out/guide-query.port';
import { RECOMMENDATION_QUERY } from './application/port/out/recommendation-query.port';
import {
  CREATE_BEACH_USE_CASE,
  GET_BEACH_USE_CASE,
  LIST_ADMIN_BEACHES_USE_CASE,
  LIST_BEACHES_USE_CASE,
  LIST_GUIDES_USE_CASE,
  LIST_RECOMMENDATIONS_USE_CASE,
  UPDATE_BEACH_USE_CASE,
} from './application/port/in/beach-use-cases';

/**
 * beach 컨텍스트 (해변 마스터 / 안내 문구 / 대응 권고 마스터).
 * 인바운드 포트(유스케이스)와 아웃바운드 포트(리포지토리/쿼리)를 DI 토큰으로 어댑터에 바인딩한다.
 *
 * 담당 테이블: beaches, static_guides(G-006), risk_recommendations(ADM-006).
 * 다른 컨텍스트(risk/operation 등)가 참조할 조회 유스케이스는 exports 로 노출한다.
 */
@Module({
  controllers: [
    PublicBeachController,
    AdminBeachController,
    PublicGuideController,
    AdminRecommendationController,
  ],
  providers: [
    // 인바운드 포트 → 유스케이스 서비스
    { provide: LIST_BEACHES_USE_CASE, useClass: ListBeachesService },
    { provide: GET_BEACH_USE_CASE, useClass: GetBeachService },
    { provide: LIST_ADMIN_BEACHES_USE_CASE, useClass: ListAdminBeachesService },
    { provide: CREATE_BEACH_USE_CASE, useClass: CreateBeachService },
    { provide: UPDATE_BEACH_USE_CASE, useClass: UpdateBeachService },
    { provide: LIST_GUIDES_USE_CASE, useClass: ListGuidesService },
    { provide: LIST_RECOMMENDATIONS_USE_CASE, useClass: ListRecommendationsService },
    // 아웃바운드 포트 → 어댑터
    { provide: BEACH_REPOSITORY, useClass: BeachPrismaRepository },
    { provide: BEACH_QUERY, useClass: BeachKyselyQuery },
    { provide: GUIDE_QUERY, useClass: GuideKyselyQuery },
    { provide: RECOMMENDATION_QUERY, useClass: RecommendationKyselyQuery },
  ],
  // 다른 컨텍스트가 해변 마스터/권고를 참조할 수 있도록 조회 유스케이스를 노출한다.
  exports: [
    GET_BEACH_USE_CASE,
    LIST_BEACHES_USE_CASE,
    LIST_RECOMMENDATIONS_USE_CASE,
  ],
})
export class BeachModule {}
