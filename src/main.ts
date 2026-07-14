import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SYSTEM_KEY_HEADER, SYSTEM_KEY_SECURITY } from './shared/auth/system-auth.guard';
import { AppConfig } from './shared/config/app.config';
import { buildCorsOrigin } from './shared/http/cors-origin';
import { GlobalExceptionFilter } from './shared/http/global-exception.filter';
import { ResponseInterceptor } from './shared/http/response.interceptor';

// BIGINT PK 가 응답으로 새어나갈 때 JSON 직렬화 오류를 막는다(bigint → string).
// 도메인은 number 를 쓰지만, Prisma 결과가 직접 노출되는 경로의 방어선.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const config = new AppConfig(configService);
  const prefix = config.apiPrefix;
  const port = config.port;

  // CORS: 프론트엔드(브라우저)에서 API 를 호출할 수 있게 허용한다.
  // CORS_ORIGIN 은 콤마 구분 목록이며 `*` 와일드카드를 지원한다(Vercel 프리뷰·localhost 포트).
  // 미지정 시 개발 편의로 모든 origin 을 허용한다. 규칙은 cors-origin.ts 참고.
  app.enableCors({
    origin: buildCorsOrigin(configService.get<string>('CORS_ORIGIN')),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // x-system-key: /system/* 시스템 인증 헤더(Swagger UI·운영 도구가 브라우저에서 호출할 때 필요).
    allowedHeaders: ['Content-Type', 'Authorization', SYSTEM_KEY_HEADER],
  });

  // Fly 프록시 뒤에서 동작한다. 레이트 리밋이 프록시 IP 하나로 뭉뚱그려지지 않도록
  // X-Forwarded-For 의 첫 IP 를 클라이언트 IP 로 신뢰한다(신뢰 홉 1 = Fly 프록시).
  app.set('trust proxy', 1);

  // 제보 이미지 정적 서빙.
  // 업로드 컨트롤러는 imageUrl 로 `/uploads/{filename}` 을 돌려준다. 그 값이 그대로 열려야 하므로
  // 서빙 프리픽스도 `/uploads/` 다. 정적 자산은 setGlobalPrefix('api')의 영향을 받지 않으므로
  // 최종 URL 은 `/uploads/xxx.jpg`(=/api 없음)로 컨트롤러가 만드는 값과 정확히 일치한다.
  // 저장 위치는 UPLOAD_DIR(기본 ./uploads) — 운영은 영구 볼륨 경로를 넣는다.
  const uploadDir = config.uploadDir;
  mkdirSync(uploadDir, { recursive: true }); // 볼륨 첫 마운트 시 비어 있다.
  app.useStaticAssets(uploadDir, { prefix: config.uploadUrlPrefix });
  logger.log(`정적 업로드 서빙: ${config.uploadUrlPrefix}* -> ${uploadDir}`);

  if (config.systemApiKey === null) {
    logger.warn(
      'SYSTEM_API_KEY 미설정 — /system/* 은 전면 차단(401)된다. ' +
        '수동 트리거가 필요하면 환경변수를 설정한다(운영: fly secrets set SYSTEM_API_KEY=...).',
    );
  }

  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('JellySafe API')
    .setDescription(
      [
        '제주 연안 해파리 위험도 예측/대응 지원 서비스 API.',
        '',
        '### 경로 규약',
        '- `/public/*` : 일반 사용자 앱. 인증 불필요(비로그인 사용 가능). 남용 방지용 레이트 리밋 적용.',
        '- `/admin/*` : 관리자/운영자 웹. `Authorization: Bearer <accessToken>` 필수.',
        '- `/system/*` : 배치·운영 트리거. `x-system-key: <SYSTEM_API_KEY>` 헤더 필수(없으면 401).',
        '',
        '### 업로드 이미지',
        '제보 사진은 `POST /public/reports/image` 로 올리고, 응답의 `imageUrl`(`/uploads/파일명`)로 조회한다.',
        '이 경로는 API 프리픽스(`/api`)를 붙이지 않는다 — 예: `https://<host>/uploads/1720000000-abcd.jpg`.',
        '',
        '### 관리자 API 사용법',
        '1. `POST /admin/auth/login` 으로 accessToken 을 받는다.',
        '2. 우측 상단 **Authorize** 버튼에 그 토큰을 넣는다.',
        '3. 이후 `/admin/*` 을 호출한다.',
        '',
        '### 공통 응답 형태',
        '모든 성공 응답은 `{ "success": true, "data": ... }` 로 감싸진다.',
        '목록형(페이지네이션) API 는 `data` 안에 `items` 와 `page/size/total` 이 들어간다.',
        '실패 응답은 `{ "success": false, "error": { "code", "message" } }`.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    // 관리자 API 는 Bearer JWT 필요. Swagger 상단 Authorize 에 토큰 입력.
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    // 시스템 API(/system/*)는 공유 키 헤더 필요. Authorize 에 SYSTEM_API_KEY 값을 넣는다.
    .addApiKey(
      {
        type: 'apiKey',
        name: SYSTEM_KEY_HEADER,
        in: 'header',
        description: '배치·운영 트리거 전용 공유 키. 값은 서버 환경변수 SYSTEM_API_KEY 와 같아야 한다.',
      },
      SYSTEM_KEY_SECURITY,
    )
    .addTag('risk', '위험도 — 해변별 해파리 위험 단계 조회, 관리자 대시보드, 위험도 산출 트리거')
    .addTag('beach', '해변 — 해변 검색/상세, 해변 마스터 관리, 안내 문구')
    .addTag('report', '제보 — 사용자의 해파리 목격 제보 접수·이미지 업로드, 관리자 검수')
    .addTag('favorite', '관심 해변 — 즐겨찾기 등록/해제/목록')
    .addTag('notification', '알림 — 사용자 알림함, 관리자 알림 문구 생성·발송')
    .addTag('operation', '운영 대응 — 대응 권고 조회, 대응 기록 저장, 해변 운영 상태')
    .addTag('dailyreport', '일간 리포트 — 해변별 하루치 운영 리포트 생성/조회/메모')
    .addTag('observation', '관측 데이터 — 외부 수집 소스 상태, 관측치 조회')
    .addTag('user', '계정 — 관리자 로그인/등록, 사용자 목록, 감사 로그')
    .addTag('secondary-partner', '[2차 확장] 파트너 연동 골격 — MVP 연동 대상 아님')
    .addTag('secondary-subscription', '[2차 확장] 구독 골격 — MVP 연동 대상 아님')
    .addTag('secondary-mlmodel', '[2차 확장] ML 모델 관리 골격 — MVP 연동 대상 아님')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  applySystemSecurity(document);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port);
}

/**
 * `/system/*` 오퍼레이션에 시스템 키 보안 요구사항을 붙이고, 설명의 낡은 경고 문구를 고친다.
 *
 * 시스템 컨트롤러는 각 컨텍스트(risk/observation) 소유라 여기서 문서만 후처리한다.
 * (컨트롤러마다 @ApiSecurity 를 붙이는 것과 결과는 같다 — 한 곳에서 누락 없이 적용된다.)
 * 기존 설명에는 "인증 가드가 없으니 게이트웨이에서 막아야 한다"는 경고가 있었으나
 * 이제 SystemAuthGuard 가 실제로 막으므로 현실에 맞는 문구로 교체한다.
 */
function applySystemSecurity(document: OpenAPIObject): void {
  const NOTE =
    `🔒 이 경로는 **\`${SYSTEM_KEY_HEADER}\` 헤더(서버의 SYSTEM_API_KEY)** 가 있어야 호출된다. ` +
    '헤더가 없거나 틀리면 401. 스케줄러 배치는 HTTP 를 타지 않고 내부 유스케이스를 직접 부르므로 이 키와 무관하다.';

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (!/\/system(\/|$)/.test(path)) continue;

    for (const operation of Object.values(item ?? {})) {
      if (typeof operation !== 'object' || operation === null || !('responses' in operation)) continue;
      const op = operation as { security?: unknown[]; description?: string };

      op.security = [...(op.security ?? []), { [SYSTEM_KEY_SECURITY]: [] }];

      // 낡은 경고("인증 가드가 없다 / 게이트웨이에서 막아야 한다") 제거 후 실제 동작으로 교체.
      const lines = (op.description ?? '')
        .split('\n')
        .filter((line) => !line.includes('인증 가드'));
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      lines.push('', NOTE);
      op.description = lines.join('\n');
    }
  }
}

void bootstrap();
