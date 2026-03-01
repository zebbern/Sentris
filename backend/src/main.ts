import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import cookieParser from 'cookie-parser';

import { isVersionCheckDisabled, performVersionCheck } from './version-check';
import type { AppConfig } from './config/app.config';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const configService = app.get(ConfigService);
  const appCfg = configService.get<AppConfig>('app')!;

  await enforceVersionCheck(configService);

  // Enable cookie parsing for session auth
  app.use(cookieParser());

  // Set global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const httpAdapter = app.getHttpAdapter().getInstance();
  if (httpAdapter?.set) {
    httpAdapter.set('etag', false);
  }

  // Enable CORS for frontend
  // Build dynamic origin list for multi-instance dev (instances 0-9)
  const instanceOrigins: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const frontendPort = 5173 + i * 100;
    const backendPort = 3211 + i * 100;
    instanceOrigins.push(`http://localhost:${frontendPort}`);
    instanceOrigins.push(`http://127.0.0.1:${frontendPort}`);
    instanceOrigins.push(`http://localhost:${backendPort}`);
    instanceOrigins.push(`http://127.0.0.1:${backendPort}`);
  }

  app.enableCors({
    origin: [
      'http://localhost',
      'http://localhost:80',
      'http://localhost:8090',
      // Add production domain to CORS when deployed
      ...instanceOrigins,
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Cache-Control',
      'x-organization-id',
      'X-Real-IP',
      'X-Forwarded-For',
      'X-Forwarded-Proto',
    ],
  });
  const port = appCfg.port;
  const host = appCfg.host;

  const config = new DocumentBuilder()
    .setTitle('Sentris Flow API')
    .setDescription('Sentris backend API')
    .setVersion('0.1.0')
    .addServer('/api/v1', 'API v1')
    .build();

  try {
    const document = SwaggerModule.createDocument(app, config);
    const cleaned = cleanupOpenApiDoc(document);
    SwaggerModule.setup('api/v1/docs', app, cleaned);
  } catch (err) {
    Logger.warn(
      `Swagger doc generation failed — API docs will be unavailable: ${err instanceof Error ? err.message : String(err)}`,
      'Bootstrap',
    );
  }

  await app.listen(port, host);
  Logger.log(`🚀 Sentris backend listening on http://${host}:${port}`, 'Bootstrap');
}

const versionLogger = new Logger('VersionCheck');

async function enforceVersionCheck(configService: ConfigService) {
  if (isVersionCheckDisabled(process.env)) {
    versionLogger.warn('Skipping version validation (disabled via env).');
    return;
  }

  const appCfg = configService.get<AppConfig>('app')!;

  try {
    const result = await performVersionCheck({
      baseUrl: appCfg.versionCheckUrl,
      timeoutMs: appCfg.versionCheckTimeoutMs,
    });
    const currentVersion = appCfg.versionCheckVersion ?? result.response.min_supported_version;
    const latest = result.response.latest_version;

    if (result.outcome === 'unsupported') {
      versionLogger.error(
        `Version ${currentVersion} is no longer supported. Latest available: ${latest}.`,
      );
      if (result.response.upgrade_url) {
        versionLogger.error(`Upgrade URL: ${result.response.upgrade_url}`);
      }
      process.exit(1);
    }

    if (result.outcome === 'upgrade') {
      versionLogger.warn(`Version ${latest} is available. You are running ${currentVersion}.`);
      if (result.response.upgrade_url) {
        versionLogger.warn(`Upgrade URL: ${result.response.upgrade_url}`);
      }
    } else if (result.outcome === 'ok') {
      versionLogger.log(`Version ${currentVersion} is supported.`);
    }
  } catch (error) {
    versionLogger.warn(
      'Failed to contact version service. Continuing without enforcement.',
      error instanceof Error ? error.stack : String(error),
    );
  }
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap Sentris backend', error);
  process.exit(1);
});
