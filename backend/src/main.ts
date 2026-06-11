import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  // Trust the edge nginx hop so Express (and therefore @nestjs/throttler) reads
  // the original client IP from X-Forwarded-For. Without this every request
  // looks like it came from the docker bridge → the per-IP rate limiter
  // applies globally to the entire LAN, locking out all users together once
  // any one of them hits the limit.
  app.set('trust proxy', 1);

  const config = app.get(AppConfigService);

  // Route Socket.IO broadcasts through Redis pub/sub so realtime events reach
  // clients on any backend replica. Skipped when Redis isn't configured —
  // single-process deployments work fine on the default in-memory adapter.
  if (config.redisEnabled) {
    app.useWebSocketAdapter(
      new RedisIoAdapter(app).useRedis(config.redisHost, config.redisPort),
    );
  }

  // For a LAN pet-project served over plain HTTP:
  //   - CSP off:  Swagger UI uses inline scripts and eval(); strict CSP makes
  //               /api/docs blank.
  //   - HSTS off: the default `Strict-Transport-Security` header tells the
  //               browser to force HTTPS on this host for ~180 days. Once you
  //               visit once over HTTP, the cached HSTS upgrades subsequent
  //               HTTP requests to HTTPS — and we don't have an HTTPS server.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    }),
  );
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Task Tracker API')
    .setDescription('REST API for the Task Tracker pet-project')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  // Path 'docs' + useGlobalPrefix → served at /api/docs. Passing 'api/docs'
  // literally causes Swagger UI to emit asset URLs like /api/docs/docs/foo.png
  // (the prefix gets baked in twice).
  SwaggerModule.setup('docs', app, doc, { useGlobalPrefix: true });

  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API listening on :${config.port}`, 'Bootstrap');
}

bootstrap();
