import { plainToInstance } from 'class-transformer';
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
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvSchema, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`환경 변수 검증 실패:\n  - ${messages}`);
  }
  return config;
}
