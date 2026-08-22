import { Module } from '@nestjs/common';
import { AdminGroundtruthController } from './adapter/in/web/admin-groundtruth.controller';
import { SystemEvaluationController } from './adapter/in/web/system-evaluation.controller';
import { EvaluationScheduler } from './adapter/in/schedule/evaluation.scheduler';
import { GroundtruthPrismaRepository } from './adapter/out/persistence/groundtruth.prisma-repository';
import { GroundtruthKyselyQuery } from './adapter/out/persistence/groundtruth.kysely-query';
import { RecordGroundtruthService } from './application/service/record-groundtruth.service';
import { EvaluatePredictionsService } from './application/service/evaluate-predictions.service';
import { GetAccuracyService } from './application/service/get-accuracy.service';
import {
  EVALUATE_PREDICTIONS_USE_CASE,
  GET_ACCURACY_USE_CASE,
  LIST_GROUNDTRUTH_USE_CASE,
  RECORD_FIELD_OBSERVATION_USE_CASE,
  RECORD_STING_INCIDENT_USE_CASE,
} from './application/port/in/groundtruth-use-cases';
import {
  ACCURACY_QUERY,
  EVALUATION_REPOSITORY,
  FIELD_OBSERVATION_REPOSITORY,
  GROUNDTRUTH_QUERY,
  RISK_PREDICTION,
  STING_INCIDENT_REPOSITORY,
} from './application/port/out/groundtruth-ports';

/**
 * groundtruth 컨텍스트 — **정답 데이터.**
 *
 * 이 서비스가 자기가 맞았는지 알 수 있게 하는 유일한 경로다. 위험도는 `해변 × 시점` 으로
 * 내는데 검증에 쓴 정답은 `시군구 × 주` 였다(docs/backtest.md). 여기 쌓이는 현장 관측과
 * 쏘임 사고가 그 격차를 메운다.
 *
 * ── 다른 컨텍스트와의 관계 ──────────────────────────────────────────────────────────
 * risk 를 **읽기만** 한다(RISK_PREDICTION 이 risk_scores 를 과거 시점으로 훑는다).
 * risk 컨텍스트의 조회 포트를 쓰지 않는 이유는 그쪽이 `is_latest`(현재 노출용)만 다루기
 * 때문이다 — 대조는 "그날 무엇을 보여줬는가" 를 묻는 다른 질문이다. 그래서 모듈 의존도 없다.
 *
 * 한 어댑터가 여러 포트를 구현한다(쓰기는 Prisma, 조회·집계는 Kysely). 세 테이블이 같은
 * 목적으로 함께 움직이고, 포트마다 파일을 쪼개면 얇은 래퍼만 늘어나기 때문이다.
 */
@Module({
  controllers: [AdminGroundtruthController, SystemEvaluationController],
  providers: [
    // 인바운드 포트 → 유스케이스
    RecordGroundtruthService,
    { provide: RECORD_FIELD_OBSERVATION_USE_CASE, useExisting: RecordGroundtruthService },
    { provide: RECORD_STING_INCIDENT_USE_CASE, useExisting: RecordGroundtruthService },
    { provide: LIST_GROUNDTRUTH_USE_CASE, useExisting: RecordGroundtruthService },
    { provide: EVALUATE_PREDICTIONS_USE_CASE, useClass: EvaluatePredictionsService },
    { provide: GET_ACCURACY_USE_CASE, useClass: GetAccuracyService },

    // 아웃바운드 포트 → 어댑터 (쓰기: Prisma)
    GroundtruthPrismaRepository,
    { provide: FIELD_OBSERVATION_REPOSITORY, useExisting: GroundtruthPrismaRepository },
    { provide: STING_INCIDENT_REPOSITORY, useExisting: GroundtruthPrismaRepository },
    { provide: EVALUATION_REPOSITORY, useExisting: GroundtruthPrismaRepository },

    // 아웃바운드 포트 → 어댑터 (조회·집계: Kysely)
    GroundtruthKyselyQuery,
    { provide: GROUNDTRUTH_QUERY, useExisting: GroundtruthKyselyQuery },
    { provide: RISK_PREDICTION, useExisting: GroundtruthKyselyQuery },
    { provide: ACCURACY_QUERY, useExisting: GroundtruthKyselyQuery },

    EvaluationScheduler,
  ],
})
export class GroundtruthModule {}
