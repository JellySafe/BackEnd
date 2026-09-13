import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError, ValidationError } from '@shared/kernel/domain-error';
import { kstToday, toKstDateString } from '@shared/kernel/kst-date';
import { DensityLevel } from '@contexts/observation/domain/observation-enums';
import { GroundtruthConfig } from '../../groundtruth.config';
import {
  issueQuickRecordToken,
  verifyQuickRecordToken,
} from '../../domain/quick-record-token';
import {
  OBSERVATION_COVERAGE_QUERY,
  ObservationCoverageQueryPort,
} from '../port/out/groundtruth-ports';
import {
  RECORD_FIELD_OBSERVATION_USE_CASE,
  RecordFieldObservationUseCase,
} from '../port/in/groundtruth-use-cases';

export interface QuickRecordLink {
  beachId: number;
  beachName: string;
  token: string;
  url: string | null;
  alreadyRecorded: boolean;
}

export interface QuickRecordCommand {
  token: string;
  jellyfishPresent: boolean;
  densityLevel?: DensityLevel;
  observerName?: string;
  note?: string;
}

/**
 * 현장 기록 간편 링크 — 발급과 기록.
 *
 * ── 무엇을 푸는가 ────────────────────────────────────────────────────────────────────
 * 정답 데이터가 안 쌓이는 진짜 이유는 API 가 없어서가 아니라 **절차가 무겁기 때문**이다.
 * 안전요원에게 관리자 계정을 만들어 주고, 콘솔에 로그인하게 하고, 폼을 채우게 하는 일을
 * 매일 반복시킬 수는 없다.
 *
 * 문자로 받은 링크를 눌러 "있었다/없었다" 를 고르는 데 10초. 그게 이 서비스가 만드는 것이다.
 *
 * ── 권한은 아주 좁다 ─────────────────────────────────────────────────────────────────
 * 토큰 하나가 여는 것은 **해변 하나 · 날짜 하루 · 기록 생성 하나**뿐이다. 근거와 유출 시
 * 영향은 domain/quick-record-token.ts 에 적어 두었다.
 */
@Injectable()
export class QuickRecordService {
  private readonly logger = new Logger(QuickRecordService.name);
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly groundtruthConfig: GroundtruthConfig,
    @Inject(OBSERVATION_COVERAGE_QUERY)
    private readonly coverage: ObservationCoverageQueryPort,
    @Inject(RECORD_FIELD_OBSERVATION_USE_CASE)
    private readonly recordObservation: RecordFieldObservationUseCase,
  ) {
    // 게스트 토큰과 같은 방식으로 JWT_SECRET 에서 파생한다(용도 문자열로 키를 분리).
    // 필수 환경변수가 하나도 늘지 않고, JWT_SECRET 은 env 검증이 이미 강제한다.
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  /**
   * 그날의 해변별 링크를 만든다.
   *
   * **이미 기록된 해변도 빼지 않는다.** 대신 `alreadyRecorded` 로 표시한다 — 보낼지 말지는
   * 사람이 정할 일이고, 목록에서 사라지면 "왜 이 해변은 안 나오지" 를 되묻게 된다.
   */
  async issueLinks(date?: Date): Promise<{ date: string; links: QuickRecordLink[] }> {
    const target = date ?? kstToday();
    const rows = await this.coverage.coverageFor(target);
    const base = this.groundtruthConfig.quickRecordBaseUrl;

    const links = rows.map((row) => {
      const token = issueQuickRecordToken(row.beachId, target, this.secret);
      return {
        beachId: Number(row.beachId),
        beachName: row.beachName,
        token,
        url: base === null ? null : `${base}?token=${encodeURIComponent(token)}`,
        alreadyRecorded: row.recorded,
      };
    });

    return { date: toKstDateString(target), links };
  }

  /**
   * 토큰으로 기록한다(로그인 없음).
   *
   * 실패를 두 가지로 나눠 답한다 — **위조와 만료는 사람이 할 일이 다르다.**
   *   · 위조·형식 오류 → 401. 할 수 있는 것이 없다.
   *   · 어제 링크     → 422. "오늘 링크를 다시 받으세요" 로 이어져야 한다.
   * 둘을 같은 오류로 뭉뚱그리면, 어제 문자를 누른 사람이 "고장났다" 고 판단하고 그만둔다.
   *
   * (410 Gone 이 더 맞는 의미지만, 이 한 경우 때문에 공용 오류 종류를 늘리지 않았다.
   *  구분은 상태 코드와 코드 문자열로 이미 된다.)
   */
  async record(command: QuickRecordCommand): Promise<{ observationId: number }> {
    const scope = verifyQuickRecordToken(command.token, this.secret);
    if (scope === null) {
      throw new DomainError(
        'UNAUTHORIZED',
        'QUICK_RECORD_TOKEN_INVALID',
        '유효하지 않은 기록 링크입니다. 관리자에게 링크를 다시 요청해 주세요.',
      );
    }

    const todayKey = toKstDateString(kstToday());
    if (scope.dateKey !== todayKey) {
      throw new DomainError(
        'UNPROCESSABLE',
        'QUICK_RECORD_TOKEN_EXPIRED',
        `이 링크는 ${scope.dateKey} 자 기록용입니다. 오늘(${todayKey}) 링크를 다시 받아 주세요.`,
        { linkDate: scope.dateKey, today: todayKey },
      );
    }

    // 도메인이 "봤다면 밀도 필수" 를 강제하지만, 여기서 먼저 걸러 메시지를 상황에 맞게 준다
    // (간편 화면에서는 밀도 선택이 빠지기 쉽다).
    if (command.jellyfishPresent && command.densityLevel === undefined) {
      throw new ValidationError(
        'FIELD_OBS_DENSITY_REQUIRED',
        '해파리를 봤다면 얼마나 있었는지(저/중/고)도 함께 골라 주세요.',
      );
    }

    const result = await this.recordObservation.recordObservation({
      beachId: scope.beachId,
      observedAt: new Date(),
      source: 'lifeguard',
      jellyfishPresent: command.jellyfishPresent,
      densityLevel: command.densityLevel,
      observerName: command.observerName,
      note: command.note,
      // 로그인하지 않았으므로 계정을 붙일 수 없다. 누가 했는지는 observerName 이 전부다.
      observerId: null,
    });

    this.logger.log(
      `간편 기록 (beachId=${scope.beachId}, 해파리=${command.jellyfishPresent ? '있음' : '없음'}, ` +
        `기록자=${command.observerName ?? '미기재'})`,
    );

    return { observationId: Number(result.observationId) };
  }
}
