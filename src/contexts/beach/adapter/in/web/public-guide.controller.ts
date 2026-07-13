import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkDataArray } from '@shared/http/api-response.decorator';
import {
  ListGuidesUseCase,
  LIST_GUIDES_USE_CASE,
} from '../../../application/port/in/beach-use-cases';
import { ListGuidesQuery } from './dto/list-guides.query';
import { StaticGuideResponse } from './dto/static-guide.response';

/**
 * 안내/고지 문구 API (G-006). 로그인 없이 조회 가능.
 */
@ApiTags('beach')
@Controller('public/guides')
export class PublicGuideController {
  constructor(@Inject(LIST_GUIDES_USE_CASE) private readonly listGuides: ListGuidesUseCase) {}

  /** G-006 활성 안내 문구 조회 (targetType/riskLevel 필터) */
  @ApiOperation({
    summary: '[앱] 안내/고지 문구 — 앱에 띄울 안전수칙·주의문구',
    description: [
      '"해파리를 보면 만지지 마세요" 같은 **정적 안내 문구**를 서버에서 받아온다(G-006).',
      '문구가 바뀌어도 앱을 새로 배포할 필요가 없도록 DB 로 뺀 것.',
      '',
      '- `riskLevel` 로 필터하면 해당 위험 단계용 문구만 받는다.',
      '- `targetType` 으로 대상(일반 사용자/운영자)을 구분한다.',
      '',
      '인증 불필요.',
    ].join('\n'),
  })
  @ApiOkDataArray(StaticGuideResponse)
  @Get()
  list(@Query() query: ListGuidesQuery) {
    return this.listGuides.list({ targetType: query.targetType, riskLevel: query.riskLevel });
  }
}
