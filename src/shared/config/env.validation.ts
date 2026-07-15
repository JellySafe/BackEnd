import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

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

  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET 이 필요합니다.' })
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
