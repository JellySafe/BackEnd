import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { CurrentUser, Roles } from '@shared/auth/auth.decorators';
import { AuthUser } from '@shared/auth/auth-user';
import { Page, normalizePageRequest } from '@shared/kernel/pagination';
import { QuickRecordService } from '../../../application/service/quick-record.service';
import { kstToday, parseKstDateKey, toKstDateString } from '@shared/kernel/kst-date';
import {
  AccuracyReport,
  GET_ACCURACY_USE_CASE,
  GetAccuracyUseCase,
  LIST_GROUNDTRUTH_USE_CASE,
  ListGroundtruthUseCase,
  RECORD_FIELD_OBSERVATION_USE_CASE,
  RECORD_STING_INCIDENT_USE_CASE,
  RecordFieldObservationUseCase,
  RecordStingIncidentUseCase,
} from '../../../application/port/in/groundtruth-use-cases';
import {
  FieldObservationRow,
  OBSERVATION_COVERAGE_QUERY,
  ObservationCoverageQueryPort,
  StingIncidentRow,
} from '../../../application/port/out/groundtruth-ports';
import {
  AccuracyQuery,
  AccuracyReportResponse,
  GroundtruthListQuery,
  RecordFieldObservationRequest,
  RecordFieldObservationResponse,
  RecordStingIncidentRequest,
  ObservationCoverageResponse,
  QuickRecordLinksResponse,
  RecordStingIncidentResponse,
} from './dto/groundtruth.dto';

/**
 * 정답 데이터 관리자 API.
 *
 * ── 이 API 가 이 서비스의 개선 경로다 ───────────────────────────────────────────────
 * 지금까지 이 서비스는 자기가 맞았는지 알 수 없었다. 위험도는 `해변 × 시점` 으로 내는데
 * 검증에 쓴 정답은 `시군구 × 주` 였기 때문이다(docs/backtest.md). 여기 쌓이는 기록이
 * 그 격차를 메우고, `GET /admin/accuracy` 가 그 결과를 보여준다.
 *
 * 역할은 `operator|admin` 기본값을 쓴다 — 현장 관측을 넣는 사람이 운영자이기 때문이다.
 * (@Roles 를 생략하면 관리자 경로 기본값이 걸린다 — jwt-auth.guard.ts)
 */
@ApiTags('groundtruth')
@Controller('admin')
export class AdminGroundtruthController {
  constructor(
    @Inject(RECORD_FIELD_OBSERVATION_USE_CASE)
    private readonly recordObservation: RecordFieldObservationUseCase,
    @Inject(RECORD_STING_INCIDENT_USE_CASE)
    private readonly recordIncident: RecordStingIncidentUseCase,
    @Inject(LIST_GROUNDTRUTH_USE_CASE) private readonly list: ListGroundtruthUseCase,
    @Inject(GET_ACCURACY_USE_CASE) private readonly accuracy: GetAccuracyUseCase,
    // 수집 체크리스트는 유스케이스를 거치지 않고 읽기 모델을 바로 쓴다. 도메인 규칙이 없는
    // 운영 조회라, 유스케이스를 만들어 그대로 통과시키면 계층만 늘어난다.
    @Inject(OBSERVATION_COVERAGE_QUERY)
    private readonly coverageQuery: ObservationCoverageQueryPort,
    private readonly quickRecord: QuickRecordService,
  ) {}

  @ApiOperation({
    summary: '[관리자] 현장 관측 기록 — 안전요원 정기 관측',
    description: [
      '해변에서 직접 본 것을 기록한다. 시민 제보(`/public/reports`)와는 **성격이 다르다.**',
      '',
      '⚠️ **해파리를 못 봤을 때도 반드시 기록한다**(`jellyfishPresent: false`).',
      '시민 제보는 본 사람만 올리므로 "제보 없음" 이 "해파리 없음" 을 뜻하지 않는다.',
      '그 데이터로는 **오경보를 셀 수 없다** — 경보했는데 실제로 안전했는지 확인할 방법이 없기 때문이다.',
      '부재 관측이 정답 데이터의 절반이고, 그것이 없으면 이 서비스는 영원히 자기 오경보율을 모른다.',
      '',
      '`jellyfishPresent=true` 면 `densityLevel` 이 필수이고, false 면 넣을 수 없다(둘 다 400).',
    ].join('\n'),
  })
  @ApiOkData(RecordFieldObservationResponse)
  @Post('field-observations')
  async createObservation(
    @Body() body: RecordFieldObservationRequest,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<RecordFieldObservationResponse> {
    const result = await this.recordObservation.recordObservation({
      beachId: body.beachId,
      observedAt: new Date(body.observedAt),
      source: body.source,
      jellyfishPresent: body.jellyfishPresent,
      densityLevel: body.densityLevel ?? null,
      speciesId: body.speciesId ?? null,
      estimatedCount: body.estimatedCount ?? null,
      observerName: body.observerName ?? null,
      note: body.note ?? null,
      // 기록자는 요청 본문이 아니라 인증에서만 나온다.
      observerId: user?.userId ?? null,
    });
    return { observationId: result.observationId };
  }

  @ApiOperation({
    summary: '[관리자] 현장 관측 목록',
    description:
      '기간·해변·출처로 거른다. `jellyfishPresent=false` 로 **부재 관측만** 볼 수 있다(관측이 실제로 돌고 있는지 확인하는 용도).',
  })
  @Get('field-observations')
  listObservations(@Query() query: GroundtruthListQuery): Promise<Page<FieldObservationRow>> {
    return this.list.listObservations(
      {
        beachId: query.beachId,
        source: query.source,
        jellyfishPresent: query.jellyfishPresent,
        from: query.from === undefined ? undefined : parseKstDateKey(query.from),
        to: query.to === undefined ? undefined : parseKstDateKey(query.to),
      },
      normalizePageRequest(query.page, query.size),
    );
  }

  @ApiOperation({
    summary: '[관리자] 간편 기록 링크 발급 — 안전요원에게 문자로 보낼 링크',
    description: [
      '해변별로 **로그인 없이 그날만 기록할 수 있는 링크**를 만든다. 문자로 보내면 된다.',
      '',
      '**왜 이런 걸 만드나**',
      '정답 데이터가 안 쌓이는 이유는 API 가 없어서가 아니라 절차가 무겁기 때문이다. 안전요원에게',
      '관리자 계정을 만들어 주고 매일 콘솔에 로그인시키는 일은 며칠 만에 멎는다.',
      '',
      '**권한은 아주 좁다** — 토큰 하나가 여는 것은 해변 하나·날짜 하루·기록 생성뿐이다.',
      '어제 링크로 오늘을 기록할 수 없고, A 해변 링크로 B 해변을 기록할 수 없다.',
      '',
      '이미 기록된 해변도 목록에서 빼지 않는다(`alreadyRecorded: true` 로 표시). 보낼지 말지는',
      '사람이 정할 일이고, 사라지면 "왜 이 해변은 안 나오지" 를 되묻게 된다.',
      '',
      '같은 해변·같은 날이면 **항상 같은 토큰**이다 — 문자를 다시 보내도 먼저 받은 링크가 살아 있다.',
      '',
      '`QUICK_RECORD_BASE_URL` 이 설정돼 있으면 `url` 이 함께 채워진다(없으면 `token` 으로 직접 만든다).',
    ].join('\n'),
  })
  @ApiOkData(QuickRecordLinksResponse)
  @Post('field-observations/quick-links')
  issueQuickLinks() {
    return this.quickRecord.issueLinks();
  }

  @ApiOperation({
    summary: '[관리자] 오늘 아직 기록되지 않은 해변 — 정답 데이터 수집 체크리스트',
    description: [
      '그날 현장 관측이 기록된 해변과 **아직 안 된 해변**을 함께 준다. 운영 화면에서 체크리스트로',
      '쓰는 것이 목적이다.',
      '',
      '**왜 필요한가**',
      '정답 데이터를 넣는 API 는 이미 있는데 아무도 넣지 않아 빈 채로 돌고 있었다. 입력이 무거워서가',
      '아니다(필수 항목이 넷뿐이다) — **오늘 무엇을 기록해야 하는지 아무도 모르기** 때문이다.',
      '',
      '⚠️ **더 중요한 이유가 있다.** 사람이 자연스럽게 남기는 기록에는 치우침이 있다 — 해파리를',
      '봤을 때는 기록하지만 **아무것도 없던 날은 그냥 지나간다.** 그러면 `correct_negative` 와',
      '`false_alarm` 이 쌓이지 않아 **오경보율과 정밀도를 영영 잴 수 없다**(정확도 넷 중 둘).',
      '',
      '이 목록을 채우는 행위 자체가 "없었다" 기록을 만들게 하는 것이 설계 의도다.',
      '`jellyfishPresent: false` 도 훌륭한 정답 데이터다.',
      '',
      '`date` 를 생략하면 오늘(KST)이다. 기록이 없는 해변도 목록에서 빼지 않는다 — 빼면 정작',
      '채워야 할 곳이 사라진다.',
    ].join('\n'),
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-09-13',
    description: '기준 일자(YYYY-MM-DD, KST). 생략하면 오늘',
  })
  @ApiOkData(ObservationCoverageResponse)
  @Get('field-observations/coverage')
  async coverage(@Query('date') date?: string): Promise<ObservationCoverageResponse> {
    const dateKey = date === undefined ? kstToday() : parseKstDateKey(date);
    const beaches = await this.coverageQuery.coverageFor(dateKey);

    return {
      date: toKstDateString(dateKey),
      totalBeaches: beaches.length,
      recordedBeaches: beaches.filter((beach) => beach.recorded).length,
      beaches: beaches.map((beach) => ({
        ...beach,
        beachId: Number(beach.beachId),
        lastObservedAt:
          beach.lastObservedAt === null ? null : beach.lastObservedAt.toISOString(),
      })),
    };
  }

  @ApiOperation({
    summary: '[관리자] 쏘임 사고 기록 — 가장 강한 정답 데이터',
    description: [
      '실제로 피해가 난 사고를 기록한다. 현장 관측이 "위험해 보였다" 라면 이건 "실제로 다쳤다" 이다.',
      '예측이 맞았는지 따질 때 다른 무엇보다 이 기록이 먼저다.',
      '',
      '⚠️ **환자의 이름·연락처·상병은 받지 않는다.** 스키마에 아예 없어 보내면 400 이다.',
      '필요한 것은 "그날 그 해변에서 몇 명이 얼마나 다쳤는가" 뿐이고 그 이상은 보관할 근거가 없다.',
      '',
      '같은 외부 식별자(`externalRef`)의 사고가 이미 있으면 `possibleDuplicate: true` 로 알려주되',
      '**저장은 한다.** 기계가 병합하면 시각·인원이 조금씩 다른 두 기록이 합쳐지면서 사고 건수가 조용히 줄어든다.',
    ].join('\n'),
  })
  @ApiOkData(RecordStingIncidentResponse)
  @Post('sting-incidents')
  async createIncident(
    @Body() body: RecordStingIncidentRequest,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<RecordStingIncidentResponse> {
    return this.recordIncident.recordIncident({
      beachId: body.beachId,
      occurredAt: new Date(body.occurredAt),
      source: body.source,
      severity: body.severity,
      patientCount: body.patientCount,
      speciesId: body.speciesId ?? null,
      externalRef: body.externalRef ?? null,
      note: body.note ?? null,
      reportedBy: user?.userId ?? null,
    });
  }

  @ApiOperation({ summary: '[관리자] 쏘임 사고 목록' })
  @Get('sting-incidents')
  listIncidents(@Query() query: GroundtruthListQuery): Promise<Page<StingIncidentRow>> {
    return this.list.listIncidents(
      {
        beachId: query.beachId,
        from: query.from === undefined ? undefined : parseKstDateKey(query.from),
        to: query.to === undefined ? undefined : parseKstDateKey(query.to),
      },
      normalizePageRequest(query.page, query.size),
    );
  }

  @ApiOperation({
    summary: '[관리자] 예측 정확도 — 이 서비스가 맞고 있는가',
    description: [
      '과거 예측과 실제(현장 관측·쏘임 사고)를 대조한 결과다.',
      '',
      '**지표 하나로 품질을 말할 수 없다.** 항상 경보하면 재현율은 1 이지만 오경보율도 1 이고,',
      '절대 경보하지 않으면 오경보율은 0 이지만 재현율도 0 이다. 셋을 같이 본다.',
      '',
      '- `recall`(재현율) — 위험했던 날 중 경보한 비율. **1 에서 이 값을 뺀 것이 놓친 비율이다.**',
      '- `precision`(정밀도) — 경보한 날 중 실제로 위험했던 비율. 낮으면 경보가 무시당하기 시작한다.',
      '- `falseAlarmRate`(오경보율) — 안전했던 날 중 경보한 비율. 알림 피로의 직접 지표다.',
      '',
      '분모가 0 이면 **null 이다**(0 이 아니다) — 데이터가 없는데 지표가 좋아 보이는 착시를 막는다.',
      '',
      '`byBeach` 가 이 화면의 핵심이다. 기존 백테스트는 정답이 시군구 단위라',
      '협재와 함덕을 구분할 수 없었다. 해변별 변별력을 보는 유일한 창이다.',
    ].join('\n'),
  })
  @ApiOkData(AccuracyReportResponse)
  @Roles('admin')
  @Get('accuracy')
  getAccuracy(@Query() query: AccuracyQuery): Promise<AccuracyReport> {
    return this.accuracy.getReport({
      beachId: query.beachId,
      from: query.from === undefined ? undefined : parseKstDateKey(query.from),
      to: query.to === undefined ? undefined : parseKstDateKey(query.to),
    });
  }
}
