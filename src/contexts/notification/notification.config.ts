import { ConfigService } from '@nestjs/config';

/**
 * Web Push VAPID 설정. 세 값이 한 세트다.
 * 공개키는 브라우저가 구독할 때(applicationServerKey), 비밀키는 서버가 서명할 때 쓴다.
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** 푸시 서비스가 문제 발생 시 연락할 주소. `mailto:` 또는 `https:` 여야 한다(RFC 8292). */
  subject: string;
}

/** VAPID_SUBJECT 미설정 시 기본값. 푸시 서비스는 형식만 맞으면 받아준다. */
const DEFAULT_VAPID_SUBJECT = 'mailto:noreply@jellysafe.kr';

/** 푸시 TTL 기본값(초). 위험 경보는 늦게 도착하면 의미가 없으므로 짧게 잡는다(1시간). */
const DEFAULT_PUSH_TTL_SECONDS = 3600;

/**
 * 한 알림에 대해 동시에 보낼 최대 구독 수.
 * 순차 발송은 구독 수에 비례해 배치를 지연시키고, 무제한 병렬은 소켓/커넥션을 고갈시킨다.
 */
const DEFAULT_PUSH_CONCURRENCY = 5;

/**
 * notification 컨텍스트 전용 환경 변수 헬퍼.
 * 공용 AppConfig(@shared/config) 와 같은 방식(ConfigService 래핑)이며,
 * 알림 보관 정책과 Web Push(VAPID) 설정을 여기서 읽는다.
 */
export class NotificationConfig {
  constructor(private readonly config: ConfigService) {}

  /** 알림 보관 일수. 이보다 오래된 알림은 파기한다. 0 이면 파기하지 않는다. */
  get notificationRetentionDays(): number {
    const raw = Number(this.config.get<string>('NOTIFICATION_RETENTION_DAYS') ?? '90');
    return Number.isFinite(raw) && raw >= 0 ? raw : 90;
  }

  /** 알림 파기 배치 크론. 'off' 면 비활성. 다른 파기 배치(03:20/03:40)와 겹치지 않게 03:50. */
  get notificationPurgeCron(): string {
    return this.config.get<string>('NOTIFICATION_PURGE_CRON') ?? '0 50 3 * * *';
  }

  /**
   * Web Push VAPID 키. **공개키/비밀키 중 하나라도 비면 null** 을 돌려주고,
   * 이때 서버는 푸시를 보내지 않는다(경고 로그만 남기고 앱은 정상 동작).
   *
   * 알림은 계속 notifications 테이블에 쌓이고 인앱 알림함(GET /public/alerts)도 그대로
   * 작동한다. 수집기들의 mock 폴백과 같은 철학이다 — 외부 자격증명이 없다고 부팅이 막히면 안 된다.
   *
   * 키 생성: `npx web-push generate-vapid-keys`
   */
  get vapid(): VapidConfig | null {
    const publicKey = (this.config.get<string>('VAPID_PUBLIC_KEY') ?? '').trim();
    const privateKey = (this.config.get<string>('VAPID_PRIVATE_KEY') ?? '').trim();
    if (publicKey === '' || privateKey === '') {
      return null;
    }
    const subject = (this.config.get<string>('VAPID_SUBJECT') ?? '').trim();
    return {
      publicKey,
      privateKey,
      subject: subject === '' ? DEFAULT_VAPID_SUBJECT : subject,
    };
  }

  /** 푸시 TTL(초). 푸시 서비스가 오프라인 기기에 대해 이 시간까지만 보관한다. */
  get pushTtlSeconds(): number {
    const raw = Number(
      this.config.get<string>('PUSH_TTL_SECONDS') ?? String(DEFAULT_PUSH_TTL_SECONDS),
    );
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_PUSH_TTL_SECONDS;
  }

  /** 한 알림당 동시 발송 구독 수 상한. */
  get pushConcurrency(): number {
    const raw = Number(
      this.config.get<string>('PUSH_CONCURRENCY') ?? String(DEFAULT_PUSH_CONCURRENCY),
    );
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PUSH_CONCURRENCY;
  }

  /** SMS 발송 사업자. 기본 none(발송하지 않음). */
  get smsProvider(): SmsProvider {
    return (this.config.get<string>('SMS_PROVIDER') ?? 'none') as SmsProvider;
  }

  /**
   * SENS 설정. **네 값이 한 세트라 하나라도 비면 null** 을 돌려주고 발송을 켜지 않는다.
   *
   * 부분 설정으로 켜지면 발송할 때마다 401/400 이 나고, 그 실패는 사용자에게 "알림이 안 온다"
   * 로만 보인다. 없는 것과 잘못된 것을 구분해 두는 편이 낫다.
   */
  get sens(): SensConfig | null {
    const serviceId = (this.config.get<string>('SENS_SERVICE_ID') ?? '').trim();
    const accessKey = (this.config.get<string>('SENS_ACCESS_KEY') ?? '').trim();
    const secretKey = (this.config.get<string>('SENS_SECRET_KEY') ?? '').trim();
    const from = (this.config.get<string>('SENS_FROM') ?? '').trim();
    if (serviceId === '' || accessKey === '' || secretKey === '' || from === '') return null;
    return { serviceId, accessKey, secretKey, from };
  }

  /**
   * SMS 를 보낼 최소 위험 단계. 기본 danger.
   *
   * SMS 는 **건당 과금**이고 사용자에게도 방해가 크다. 주의 단계까지 문자로 보내면 비용과
   * 알림 피로가 함께 늘고, 정작 위험 단계 문자가 묻힌다. 푸시는 무료라 지금처럼 모든 상승에
   * 보내되, 문자는 danger 로 올라갈 때만 보낸다.
   */
  get smsMinRiskLevel(): 'caution' | 'danger' {
    const raw = (this.config.get<string>('SMS_MIN_RISK_LEVEL') ?? 'danger').trim();
    return raw === 'caution' ? 'caution' : 'danger';
  }
}

/** 네이버 클라우드 SENS 설정. 네 값이 한 세트다(하나라도 비면 발송을 켤 수 없다). */
export interface SensConfig {
  serviceId: string;
  accessKey: string;
  secretKey: string;
  /** 발신번호. **사전등록된 번호만** 쓸 수 있다(전기통신사업법). */
  from: string;
}

/** SMS 발송 사업자. none 이면 발송하지 않는다(기본). */
export type SmsProvider = 'none' | 'sens';
