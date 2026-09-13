import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * groundtruth 컨텍스트 설정.
 *
 * 여기 있는 값은 전부 **"무엇을 정답으로 인정할 것인가"** 를 정한다. 정확도 숫자가 이 값에
 * 따라 달라지므로, 바꿀 때는 왜 바꾸는지가 기록에 남아야 한다.
 */
@Injectable()
export class GroundtruthConfig {
  constructor(private readonly config: ConfigService) {}

  /**
   * 제3자 출현 기록(국립수산과학원 속보 등)을 정답 데이터로 쓸지.
   *
   * ── 왜 끌 수 있게 두나 ───────────────────────────────────────────────────────────
   * 이 소스는 **현장 관측·사고보다 약한 증거**다. 해변에서 관측한 것이 아니라 인근 해역에서
   * 보고된 출현을 거리로 끌어온 것이라, "이 해변이 그날 위험했다" 는 판정으로는 한 단계
   * 간접적이다.
   *
   * 그 약한 증거를 섞은 숫자와 섞지 않은 숫자는 다른 값이고, **어느 쪽을 볼지는 보는 사람이
   * 정해야 한다.** 끄면 현장 관측과 쏘임 사고만으로 잰다.
   *
   * 기본은 켬이다 — 지금은 현장 관측이 거의 없어서, 끄면 정확도를 아예 못 잰다.
   * 거친 숫자라도 있는 편이 "전혀 모름" 보다 낫되, 그 거칢을 문서로 분명히 한다.
   */
  get useOccurrencesAsActual(): boolean {
    return (this.config.get<string>('GROUNDTRUTH_USE_OCCURRENCES') ?? 'true').trim() !== 'false';
  }

  /**
   * 출현 기록을 해변에 붙일 반경(km). 기본 10.
   *
   * ── 위험도 산출의 30km 와 왜 다른가 ───────────────────────────────────────────────
   * 엔진의 인근 출현 룰은 **30km** 를 쓴다(risk-input.port.ts). 그건 "이 해변이 위험해질
   * 수 있는가" 를 묻는 값이라 넓게 잡는 것이 맞다 — 해파리는 해류를 타고 온다.
   *
   * 하지만 정답은 다른 질문이다. **"그날 이 해변에 해파리가 있었는가."** 30km 로 잡으면
   * 제주 한쪽의 보고 하나가 섬의 거의 모든 해변을 "위험했던 날" 로 만든다. 그러면 해변별
   * 정확도가 전부 같아져 **어느 해변의 예측이 나쁜지 구분할 수 없다** — 해변별 차이를 보려고
   * 좌표 기준으로 바꿨던 이유가 그대로 사라진다.
   *
   * 10km 도 "이 해변에서 봤다" 는 아니다. 이 소스로 재는 정확도는 **거친 근사**이고, 현장
   * 관측이 쌓이면 그쪽이 대체해야 한다.
   */
  get occurrenceRadiusKm(): number {
    const raw = Number(this.config.get<string>('GROUNDTRUTH_OCCURRENCE_RADIUS_KM') ?? '10');
    if (!Number.isFinite(raw) || raw <= 0) return 10;
    // 엔진의 인근 반경(30km)을 넘기지 못하게 막는다. 그보다 넓으면 "정답" 이 "입력" 보다
    // 넓어져, 엔진이 보지도 못한 출현으로 채점하는 셈이 된다.
    return Math.min(raw, 30);
  }

  /**
   * 간편 기록 링크의 앞부분(프론트 페이지 주소). 없으면 토큰만 돌려준다.
   *
   * 서버가 링크를 통째로 만들어 주는 이유 — 이 값은 **문자로 나가는 주소**다. 발급하는 쪽마다
   * 다르게 조립하면 어떤 문자에는 안 열리는 링크가 섞인다. 한 곳에서 정한다.
   */
  get quickRecordBaseUrl(): string | null {
    const raw = (this.config.get<string>('QUICK_RECORD_BASE_URL') ?? '').trim();
    return raw.length > 0 ? raw.replace(/\/$/, '') : null;
  }

  /**
   * 관측 미기록 알림 크론. `off` 면 비활성. 기본 오후 5시(현장 근무가 끝나가는 시각).
   *
   * 왜 이 시각인가 — 너무 이르면 아직 순찰 중이라 기록할 게 없고, 너무 늦으면 이미 퇴근해서
   * 볼 사람이 없다. 하루가 끝나기 전, 아직 현장에 있을 때가 유일하게 의미 있는 순간이다.
   *
   * 서버 시각 기준이므로 운영 컨테이너의 TZ 를 확인하고 설정한다(UTC 면 08:00 이 KST 17:00).
   */
  get observationReminderCron(): string {
    return this.config.get<string>('OBSERVATION_REMINDER_CRON') ?? '0 0 8 * * *';
  }
}
