import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { isVersionCheckDisabled, performVersionCheck } from './version-check';
import type { AppConfig } from './config/app.config';

import { AppModule } from './app.module';

/**
 * Build CORS allowed origins based on environment.
 * In production, only allow explicitly configured origins.
 * In development, allow localhost origins for multi-instance dev.
 */
function buildCorsOrigins(nodeEnv: string): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  if (nodeEnv === 'production') {
    // In production without explicit CORS_ALLOWED_ORIGINS, deny all cross-origin requests.
    // Deployers must set CORS_ALLOWED_ORIGINS to their frontend domain.
    return [];
  }

  // Development: allow localhost origins for multi-instance dev (instances 0-9)
  const origins: string[] = ['http://localhost', 'http://localhost:80', 'http://localhost:8090'];
  for (let i = 0; i <= 9; i++) {
    const frontendPort = 5173 + i * 100;
    const backendPort = 3211 + i * 100;
    origins.push(`http://localhost:${frontendPort}`);
    origins.push(`http://127.0.0.1:${frontendPort}`);
    origins.push(`http://localhost:${backendPort}`);
    origins.push(`http://127.0.0.1:${backendPort}`);
  }
  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const configService = app.get(ConfigService);
  const appCfg = configService.get<AppConfig>('app')!;

  await enforceVersionCheck(configService);

  // Enable cookie parsing for session auth
  app.use(cookieParser());

  // Security headers via helmet
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // unsafe-inline required for Swagger UI (/api/v1/docs) which injects inline scripts,
          // and for Vite's dev-mode script injection. A nonce-based approach would require
          // per-request nonce generation and template integration with both Swagger and Vite.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          // unsafe-inline required for Swagger UI's inline styles and CSS-in-JS libraries.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
      // Disabled because SSE (Server-Sent Events) streaming for trace events requires
      // cross-origin resource loading that COEP blocks.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Set global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const httpAdapter = app.getHttpAdapter().getInstance();
  if (httpAdapter?.set) {
    httpAdapter.set('etag', false);
  }

  // Enable CORS for frontend
  const corsOrigins = buildCorsOrigins(appCfg.nodeEnv);

  app.enableCors({
    origin: corsOrigins,
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
