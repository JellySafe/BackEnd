import { plainToInstance } from 'class-transformer';
import {
  DEFAULT_JWT_EXPIRES,
  MAX_ACCESS_TOKEN_SECONDS,
  parseDurationSeconds,
} from './duration';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * 배포된 위험도 점수표 버전 목록. prisma/seed.ts 가 이 세 버전을 DB 에 나란히 넣는다.
 * 새 버전을 시드에 추가하면 여기에도 넣어야 기동한다(둘이 어긋나는 것을 막는 장치다).
 */
export const RISK_RULE_VERSIONS = ['v1', 'v2', 'v3'] as const;

/**
 * 환경 변수 스키마. ConfigModule.forRoot({ validate }) 에 연결해
 * 잘못된 설정으로 부팅하는 것을 기동 시점에 차단한다(fail-fast).
 */
class EnvSchema {
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  API_PREFIX?: string;

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL 이 필요합니다(mysql://...).' })
  DATABASE_URL!: string;

  /**
   * JWT 서명키 겸 게스트 토큰 HMAC 키의 원본(shared/auth/guest-token.ts).
   *
   * 길이를 강제하는 이유: `.env.example` 의 개발용 기본값을 그대로 운영에 올려도 예전에는
   * 부팅됐다. 그 키를 아는 사람은 관리자 토큰과 게스트 토큰을 **둘 다** 위조할 수 있다.
   * 32자 하한은 무차별 대입을 실용적으로 불가능하게 만드는 최소선이다
   * (운영 권장: `openssl rand -hex 32`).
   */
  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET 이 필요합니다.' })
  @MinLength(32, {
    message: 'JWT_SECRET 은 32자 이상이어야 합니다(권장: openssl rand -hex 32).',
  })
  JWT_SECRET!: string;

  /**
   * 액세스 토큰 수명(`30m`, `2h` 같은 기간 문자열, 기본 30m).
   *
   * 형식과 운영 상한은 아래 `checkAccessTokenLifetime` 이 따로 본다 — class-validator 만으로는
   * "운영일 때만 상한을 건다" 같은 **다른 변수에 기대는 규칙**을 표현할 수 없기 때문이다.
   */
  @IsOptional()
  @IsString()
  JWT_EXPIRES?: string;

  @IsOptional()
  @IsIn(['mock', 'remote'])
  VISION_AI_MODE?: string;

  /**
   * 제보 이미지 저장 경로. 미설정 시 `./uploads`(CWD 기준).
   * 운영은 영구 볼륨 마운트 경로(예: /app/uploads) — 컨테이너 FS 에 두면 재배포마다 사라진다.
   */
  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  /**
   * `/system/*` 내부 API 호출 키(헤더 x-system-key).
   * 선택값이지만 **미설정 시 /system/* 은 전면 차단(401)** 된다(fail-closed, SystemAuthGuard 참고).
   * 부팅 자체를 막지 않는 이유: 스케줄러 배치는 HTTP 를 타지 않으므로 키 없이도 서비스는 정상이다.
   */
  @IsOptional()
  @IsString()
  SYSTEM_API_KEY?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  SCHEDULER_ENABLED?: string;

  /**
   * 운영 위험도 점수표 버전.
   *
   * ⚠️ **오타가 조용한 롤백이 된다** — 그래서 여기서 값을 고정한다.
   * 예전에는 검증이 없어 `V3` 나 `v33` 같은 오타가 그대로 통과했고, DB 에 그 버전이 없으니
   * 룰 로드가 0건 → 엔진이 코드 상수 폴백(= v1 점수표)으로 조용히 되돌아갔다.
   * v1 은 인근 출현을 밀도 구분 없이 채점하던 버전이라, v3 에서 고친
   * "저밀도가 고밀도보다 위험해 보이던" 문제가 **로그 한 줄 없이 부활**한다.
   * 안전 서비스에서 점수표 버전은 기동 시점에 틀리면 뜨지 않아야 하는 값이다.
   *
   * (버전은 맞지만 DB 에 룰이 없는 경우는 CalculateRiskService 가 산출 시점에 막는다)
   */
  @IsOptional()
  @IsIn(RISK_RULE_VERSIONS, {
    message: `RISK_RULE_VERSION 은 ${RISK_RULE_VERSIONS.join(' | ')} 중 하나여야 합니다.`,
  })
  RISK_RULE_VERSION?: string;

  /** 실 수집기 실패/키 미설정 시 mock 대체 여부. 미지정 시 운영은 off, 그 외는 on. */
  @IsOptional()
  @IsIn(['true', 'false'])
  MOCK_COLLECTOR_FALLBACK?: string;

  /**
   * 리프레시 토큰 유효 일수(기본 14). 재로그인 없이 버티는 기간이자 유출 시 최대 노출 기간이다.
   * 상한 90일은 "잊힌 기기의 토큰이 반년씩 살아 있는" 상태를 막기 위한 선이다.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  REFRESH_TOKEN_EXPIRES_DAYS?: number;

  /**
   * 제보 사진·위치 보관 일수(PRIV-003, 기본 90).
   * 하한 1: 0 을 넣으면 접수 즉시 파기 대상이 되어 검수 전에 사진이 사라진다.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  REPORT_RETENTION_DAYS?: number;

  /**
   * 동의 기록 보관 일수(PRIV-001, 기본 365).
   * 제보 데이터보다 길게 두는 것이 의도다 — 수집이 적법했음을 증명할 자료가 먼저 사라지면 안 된다.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  CONSENT_RETENTION_DAYS?: number;

  /**
   * 제보 이미지 저장 드라이버.
   *
   * ⚠️ 오타를 local 로 떨어뜨리지 않고 **기동을 막는다.** `s3` 로 쓰려던 값이 오타 하나로
   * 로컬 볼륨 저장이 되면, 머신이 둘 이상일 때 사진이 갈라지고 머신을 옮기면 사라진다.
   * 그 증상은 "가끔 사진이 안 열린다" 로 한참 뒤에야 사용자 신고로 드러난다.
   * (s3 인데 S3_BUCKET 이 비어 있는 경우도 부팅 시점에 막는다 — image-storage.provider.ts)
   */
  @IsOptional()
  @IsIn(['local', 's3'], { message: 'STORAGE_DRIVER 는 local | s3 중 하나여야 합니다.' })
  STORAGE_DRIVER?: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsString()
  S3_KEY_PREFIX?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  S3_FORCE_PATH_STYLE?: string;

  /** 사전 서명 URL 유효 시간(초, 기본 300). 30~3600 범위 밖은 기본값으로 되돌린다. */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  S3_PRESIGN_EXPIRES_SECONDS?: number;

  /**
   * 문자 발송 사업자(EX-002). 기본 none — **문자는 건당 과금이고 발신번호 사전등록이 필요한**
   * 채널이라, 설정하지 않은 환경에서 실수로 나가지 않게 기본을 꺼 둔다.
   * (자격증명이 불완전하면 어댑터가 스스로 비활성이 된다. 부팅은 막지 않는다 — 부가 채널이다)
   */
  @IsOptional()
  @IsIn(['none', 'sens'], { message: "SMS_PROVIDER 는 none | sens 중 하나여야 합니다." })
  SMS_PROVIDER?: string;

  @IsOptional()
  @IsString()
  SENS_SERVICE_ID?: string;

  @IsOptional()
  @IsString()
  SENS_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  SENS_SECRET_KEY?: string;

  /** 발신번호. 사전등록된 번호만 쓸 수 있다(전기통신사업법). */
  @IsOptional()
  @IsString()
  SENS_FROM?: string;

  /** 문자를 보내는 최소 위험 단계. 기본 danger. */
  @IsOptional()
  @IsIn(['caution', 'danger'])
  SMS_MIN_RISK_LEVEL?: string;

  /**
   * 배치 락 구현. mysql(기본) | memory.
   *
   * ⚠️ 오타를 조용히 어느 한쪽으로 떨어뜨리지 않는다. `memroy` 같은 오타가 mysql 로 읽히면
   * 의도와 다르게 동작하고, 반대로 memory 로 읽히면 **머신이 여럿일 때 게이트가 사라진다.**
   * 둘 다 조용한 오작동이라 기동 시점에 막는 편이 낫다.
   */
  @IsOptional()
  @IsIn(['mysql', 'memory'], { message: 'JOB_LOCK_DRIVER 는 mysql | memory 중 하나여야 합니다.' })
  JOB_LOCK_DRIVER?: string;

  /** 원격 Vision 모델 응답 대기 상한(ms, 기본 8000). 1000 미만이면 기본값으로 되돌린다. */
  @IsOptional()
  @IsInt()
  @Min(1000)
  VISION_AI_TIMEOUT_MS?: number;
}

/**
 * 저장소에 공개돼 있는 예시/개발용 키 목록. **운영에서는 거부한다.**
 *
 * 길이 검사(32자)만으로는 이걸 막지 못한다 — 길기만 하면 통과하기 때문이다. 그런데 이 값들은
 * `.env.example` 과 깃 이력에 그대로 있어 **누구나 읽을 수 있다.** JWT_SECRET 을 아는 사람은
 * 관리자 토큰과 게스트 토큰을 둘 다 위조할 수 있으므로, 길이보다 이쪽이 실제 위험이다.
 *
 * 소문자로 비교한다(대소문자만 바꾼 값은 같은 값으로 취급).
 */
const PUBLICLY_KNOWN_SECRETS: readonly string[] = [
  'jellysafe-dev-secret-change-me-please-32',
  'jellysafe-dev-secret-change-me',
  'change-me',
  'changeme',
  'secret',
  'test-secret',
];

/**
 * 환경 변수 하나를 문자열로 읽는다.
 *
 * `validateEnv` 가 받는 값은 `Record<string, unknown>` 이다. 실제로는 전부 문자열이지만
 * 타입이 그것을 보장하지 않으므로, 문자열이 아닌 값은 **없는 것으로 취급한다**
 * (숫자나 객체를 억지로 문자열로 바꾸면 `[object Object]` 같은 값이 검사에 들어간다).
 */
function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

/**
 * 운영에서 공개된 예시 키를 쓰고 있지 않은지. 개발/테스트는 통과시킨다
 * (로컬에서까지 강제하면 `.env.example` 을 복사해 바로 띄우는 흐름이 막힌다).
 */
function checkSecretNotPublic(config: Record<string, unknown>): string | null {
  if (config.NODE_ENV !== 'production') return null;
  const secret = readString(config, 'JWT_SECRET').trim().toLowerCase();
  if (!PUBLICLY_KNOWN_SECRETS.includes(secret)) return null;
  return (
    'JWT_SECRET 이 저장소에 공개된 예시 값입니다. 운영에서는 쓸 수 없습니다 ' +
    '(`openssl rand -hex 32` 로 새로 만들어 배포 환경변수에 넣습니다).'
  );
}

/**
 * 액세스 토큰 수명 검사. 형식은 전 환경, 상한은 운영에서만 본다.
 *
 * 형식을 여기서 막는 이유: `JWT_EXPIRES=30`(단위 없음)은 ms 라이브러리가 **30밀리초**로 읽어
 * 발급 즉시 만료되는 토큰을 만든다. 그 증상은 로그인 화면에서 "비밀번호가 틀렸나?" 로 오인된다.
 *
 * 상한을 운영에서만 막는 이유: 액세스 토큰은 서버가 취소할 수 없어 수명이 곧 유출 시 최대
 * 노출 시간이다(duration.ts). 개발에서는 길게 두고 편하게 쓰더라도, 운영에 그 값이 따라
 * 올라가는 것은 배포 전에 잡아야 한다.
 */
function checkAccessTokenLifetime(config: Record<string, unknown>): string | null {
  const raw = readString(config, 'JWT_EXPIRES').trim();
  const value = raw === '' ? DEFAULT_JWT_EXPIRES : raw;

  const seconds = parseDurationSeconds(value);
  if (seconds === null) {
    return (
      `JWT_EXPIRES('${value}') 형식이 올바르지 않습니다. ` +
      '숫자 + 단위(s|m|h|d) 로 씁니다 — 예: 30m, 2h, 1d. ' +
      '단위를 빼면 밀리초로 해석돼 발급 즉시 만료되는 토큰이 됩니다.'
    );
  }

  if (config.NODE_ENV === 'production' && seconds > MAX_ACCESS_TOKEN_SECONDS) {
    return (
      `JWT_EXPIRES('${value}') 가 운영 상한(${MAX_ACCESS_TOKEN_SECONDS / 3600}시간)을 넘습니다. ` +
      '액세스 토큰은 로그아웃으로도 취소할 수 없어 이 값이 곧 유출 시 최대 노출 시간입니다. ' +
      '재발급 흐름(POST /admin/auth/refresh)이 있으므로 짧게 두어도 재로그인이 늘지 않습니다.'
    );
  }

  return null;
}

/**
 * 한 변수만 보고는 판정할 수 없는 규칙들(운영 여부에 따라 달라지는 것들).
 * class-validator 데코레이터로는 표현이 어색해 함수로 분리했다.
 */
const CROSS_FIELD_CHECKS: ((config: Record<string, unknown>) => string | null)[] = [
  checkSecretNotPublic,
  checkAccessTokenLifetime,
];

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvSchema, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  const messages = errors.map((e) => Object.values(e.constraints ?? {}).join(', '));
  for (const check of CROSS_FIELD_CHECKS) {
    const failure = check(config);
    if (failure !== null) messages.push(failure);
  }

  if (messages.length > 0) {
    throw new Error(`환경 변수 검증 실패:\n  - ${messages.join('\n  - ')}`);
  }
  return config;
}
