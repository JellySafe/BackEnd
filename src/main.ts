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
    .setDescription('제주 연안 해파리 위험도 예측/대응 지원 서비스 API')
    .setVersion('0.1.0')
    // 관리자 API 는 Bearer JWT 필요. Swagger 상단 Authorize 에 토큰 입력.
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port);
}

void bootstrap();
