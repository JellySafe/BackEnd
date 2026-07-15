import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  ListCurrentSpeciesUseCase,
  ListSpeciesUseCase,
  LIST_CURRENT_SPECIES_USE_CASE,
  LIST_SPECIES_USE_CASE,
} from '../../../application/port/in/species-use-cases';
import { CurrentSpeciesResponse } from './dto/current-species.response';
import { JellyfishSpeciesResponse } from './dto/jellyfish-species.response';
import { ListCurrentSpeciesQueryDto } from './dto/list-current-species.query';

/**
 * 해파리 종 정보(도감) API. 로그인 없이 조회 가능.
 *
 * ⚠️ 응급처치는 여기서 주지 않는다. 종별 처치법은 **의도적으로 넣지 않았다**(현행 통합 지침과 충돌).
 *    쏘임 대처는 `GET /public/guides` 의 FIRST_AID 문구 하나만 쓴다.
 */
@ApiTags('species')
@Controller('public/species')
export class PublicSpeciesController {
  constructor(
    @Inject(LIST_SPECIES_USE_CASE) private readonly listSpecies: ListSpeciesUseCase,
    @Inject(LIST_CURRENT_SPECIES_USE_CASE)
    private readonly listCurrentSpecies: ListCurrentSpeciesUseCase,
  ) {}

  /** 지금 출현 중인 종 (최근 출현 기록 × 도감) */
  @ApiOperation({
    summary: '[앱] 지금 출현 중인 해파리 — 사진과 함께',
    description: [
      '**"지금 제주에 뭐가 나왔는지"** 를 사진·독성 등급과 함께 내려준다.',
      '',
      '국립수산과학원 주간보고에서 수집한 최근 출현 기록(`jellyfish_occurrences`)에',
      '종 도감(`jellyfish_species`)을 **이름으로 붙여서** 준다.',
      '이름만으로는 사용자가 무엇이 위험한지 모르기 때문이다 — 사진이 있어야 "내가 본 게 이거구나" 가 된다.',
      '',
      '- 해변 상세 화면에서는 그 해변의 `region`(예: `제주시`) 을 넘겨 지역을 좁힌다.',
      '- `species` 가 `null` 이면 도감에 없는 종이다. 그래도 **출현 사실(이름·밀도)은 유효하니 그대로 표시하라.**',
      '- 사진(`species.imageUrl`)을 띄우면 **출처(`species.imageSource`)를 반드시 함께 표시**해야 한다.',
      '',
      '표기 주의: 주간보고는 `유령해파리류`, 도감은 `유령해파리` 로 쓴다. 서버가 정규화해서 이어 붙이므로',
      '앱은 신경 쓰지 않아도 된다. 화면에 쓰는 이름은 기관 발표 표기인 `reportedName` 이다.',
      '',
      '인증 불필요.',
    ].join('\n'),
  })
  @ApiOkDataArray(CurrentSpeciesResponse)
  @Get('current')
  current(@Query() query: ListCurrentSpeciesQueryDto) {
    return this.listCurrentSpecies.list({ region: query.region, withinDays: query.withinDays });
  }

  /** 해파리 도감 — 종 목록 전체 */
  @ApiOperation({
    summary: '[앱] 해파리 도감 — 종 목록(사진·학명·독성)',
    description: [
      '우리나라 연안에 나타나는 해파리 종 목록(국립수산과학원 종정보 기준)이다.',
      '제보 화면에서 "내가 본 게 뭐지?" 를 고르거나, 도감 화면을 그릴 때 쓴다.',
      '',
      '- `toxicity` 가 `null` 인 종은 **무해한 게 아니라 기관이 등급을 발표하지 않은 것**이다.',
      '- `features` / `appearanceSeason` 은 원문이 있는 종만 채워진다(없으면 `null` → 항목을 숨긴다).',
      '  지어낸 설명을 넣지 않았다.',
      '- 사진을 띄울 때는 `imageSource`(출처)를 반드시 함께 표시한다.',
      '',
      '인증 불필요.',
    ].join('\n'),
  })
  @ApiOkDataArray(JellyfishSpeciesResponse)
  @Get()
  list() {
    return this.listSpecies.list();
  }
}
