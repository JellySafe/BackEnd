import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkData } from '@shared/http/api-response.decorator';
import { Public } from '@shared/auth/auth.decorators';
import { QuickRecordService } from '../../../application/service/quick-record.service';
import { QuickRecordRequest, RecordFieldObservationResponse } from './dto/groundtruth.dto';

/**
 * 현장 기록 간편 API — **로그인 없이** 기록한다.
 *
 * ── 왜 공개 경로인가 ─────────────────────────────────────────────────────────────────
 * 안전요원에게 관리자 계정을 만들어 주고 매일 콘솔에 로그인시키는 절차는 며칠 만에 멎는다.
 * 문자로 받은 링크를 눌러 "있었다/없었다" 를 고르는 데 10초여야 한다.
 *
 * 대신 권한이 아주 좁다 — 토큰 하나가 여는 것은 **해변 하나 · 날짜 하루 · 기록 생성**뿐이다.
 * 유출 시 영향까지 domain/quick-record-token.ts 에 적어 두었다.
 *
 * 인증이 없으므로 레이트 리밋은 IP 기준으로 걸린다(신원이 없는 요청이다).
 */
@ApiTags('groundtruth')
@Controller('public/field-observations')
export class PublicQuickRecordController {
  constructor(private readonly quickRecord: QuickRecordService) {}

  @ApiOperation({
    summary: '[현장] 간편 기록 — 링크로 받은 토큰만으로 기록한다',
    description: [
      '관리자가 발급한 간편 링크의 토큰으로 **로그인 없이** 현장 관측을 기록한다.',
      '',
      '해변과 날짜는 **토큰에 박혀 있다.** 본문으로 받지 않으므로 다른 해변이나 다른 날짜를',
      '기록할 수 없다.',
      '',
      '**`jellyfishPresent: false`(못 봤다)도 반드시 기록해 주세요.** 사람은 해파리를 봤을 때만',
      '기록하는 경향이 있는데, 그러면 "안전했던 날" 이 안 쌓여 오경보율과 정밀도를 영영 잴 수',
      '없습니다. 아무것도 없던 날의 기록이 오히려 더 귀합니다.',
      '',
      '**오류가 두 가지로 갈린다**',
      '- 401 `QUICK_RECORD_TOKEN_INVALID` : 링크가 잘못됐다. 관리자에게 다시 요청한다.',
      '- 422 `QUICK_RECORD_TOKEN_EXPIRED` : **어제 링크다.** 오늘 링크를 다시 받으면 된다.',
      '',
      '둘을 구분하는 이유 — 어제 문자를 누른 사람이 "고장났다" 고 판단하고 그만두면 안 된다.',
      '',
      '봤다고 하면서 밀도를 빼면 400 이다. 밀도 없는 "봤다" 는 얼마나인지가 사라진 기록이다.',
    ].join('\n'),
  })
  @ApiOkData(RecordFieldObservationResponse)
  @Public()
  @Post('quick')
  record(@Body() body: QuickRecordRequest) {
    return this.quickRecord.record({
      token: body.token,
      jellyfishPresent: body.jellyfishPresent,
      densityLevel: body.densityLevel,
      observerName: body.observerName,
      note: body.note,
    });
  }
}
