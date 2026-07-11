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
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port);
}

void bootstrap();
