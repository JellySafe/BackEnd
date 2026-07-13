import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/http/global-exception.filter';
import { ResponseInterceptor } from './shared/http/response.interceptor';

// BIGINT PK 가 응답으로 새어나갈 때 JSON 직렬화 오류를 막는다(bigint → string).
// 도메인은 number 를 쓰지만, Prisma 결과가 직접 노출되는 경로의 방어선.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const prefix = config.get<string>('API_PREFIX') ?? 'api';
  const port = Number(config.get('PORT') ?? 3000);

  // CORS: 프론트엔드(브라우저)에서 API 를 호출할 수 있게 허용한다.
  // CORS_ORIGIN 에 콤마로 구분된 허용 도메인을 지정한다(예: https://app.example.com).
  // 미지정 시 개발 편의로 모든 origin 을 허용한다.
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

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
        '- `/public/*` : 일반 사용자 앱. 인증 불필요(비로그인 사용 가능).',
        '- `/admin/*` : 관리자/운영자 웹. `Authorization: Bearer <accessToken>` 필수.',
        '- `/system/*` : 배치·스케줄러 내부 호출.',
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
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port);
}

void bootstrap();
