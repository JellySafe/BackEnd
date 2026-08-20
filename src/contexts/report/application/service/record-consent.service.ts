import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@shared/config/app.config';
import {
  RecordConsentCommand,
  RecordConsentResult,
  RecordConsentUseCase,
} from '../port/in/report-use-cases';
import {
  ConsentRepositoryPort,
  CONSENT_REPOSITORY,
} from '../port/out/consent-repository.port';
import { assertReportConsents, consentExpiresAt, normalizeConsents } from '../../domain/consent';

/**
 * PRIV-001 동의 기록.
 *
 * ── 왜 이 API 가 필요했나 ────────────────────────────────────────────────────────────
 * 제보 접수(`POST /public/reports`)는 `consentLogIds` 를 **필수로** 요구하는데, 정작 그 id 를
 * 만드는 방법이 서버에 없었다. 즉 프론트는 제보를 접수시킬 방법이 없었고(빈 배열은 거부된다),
 * 유일하게 동의 로그를 만들던 곳은 데모 시드 스크립트였다. 동의 절차가 설계에는 있고 코드에는
 * 없었던 셈이다. 이 유스케이스가 그 자리를 메운다.
 *
 * ── 무엇을 기록하나 ──────────────────────────────────────────────────────────────────
 * 동의한 항목뿐 아니라 **거부한 항목도 기록한다.** "물어봤고 거부당했다"는 사실 자체가
 * "동의 없이 수집하지 않았다"의 증거다. 다만 제보에 필요한 세 항목(privacy/location/image)이
 * 하나라도 거부되면 그 자리에서 400 으로 알린다 — 어차피 제보가 거부될 텐데 기록만 남기고
 * 통과시키면 사용자는 다음 화면에서야 막힌다.
 *
 * 신원은 요청 본문이 아니라 자격증명에서만 온다(shared/auth/public-owner.ts). 남의 이름으로
 * 동의를 기록하는 일이 가능하면 동의 기록이 증거로서 의미를 잃는다.
 */
@Injectable()
export class RecordConsentService implements RecordConsentUseCase {
  private readonly config: AppConfig;

  constructor(
    @Inject(CONSENT_REPOSITORY) private readonly repository: ConsentRepositoryPort,
    configService: ConfigService,
  ) {
    this.config = new AppConfig(configService);
  }

  async record(command: RecordConsentCommand): Promise<RecordConsentResult> {
    const decisions = normalizeConsents(command.decisions);
    assertReportConsents(decisions);

    const agreedAt = new Date();
    const expiresAt = consentExpiresAt(agreedAt, this.config.consentRetentionDays);

    const saved = await this.repository.saveAll(
      decisions.map((d) => ({
        owner: command.owner,
        type: d.type,
        agreed: d.agreed,
        policyVersion: command.policyVersion,
        agreedAt,
        expiresAt,
        ipAddress: command.ipAddress,
      })),
    );

    return { consentLogIds: saved.map((s) => s.consentLogId), expiresAt };
  }
}
