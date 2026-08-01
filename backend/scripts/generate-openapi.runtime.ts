import 'reflect-metadata';

import { writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { AppModule } from '../src/app.module';

async function generateOpenApi() {
  // Skip ingest services that require external connections during OpenAPI generation.
  process.env.SKIP_INGEST_SERVICES = 'true';
  process.env.SENTRIS_SKIP_MIGRATION_CHECK = 'true';
  // These keys only construct the Nest application for schema generation.
  process.env.SECRET_STORE_MASTER_KEY =
    process.env.SECRET_STORE_MASTER_KEY ?? 'sentris-openapi-master-key-32bxx';
  process.env.INTEGRATION_STORE_MASTER_KEY =
    process.env.INTEGRATION_STORE_MASTER_KEY ?? 'sentris-openapi-master-key-32bxx';

  const outputPath = process.env.SENTRIS_OPENAPI_OUTPUT;
  if (!outputPath) throw new Error('SENTRIS_OPENAPI_OUTPUT is required');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    app.setGlobalPrefix('api/v1');
    const config = new DocumentBuilder()
      .setTitle('Sentris Flow API')
      .setDescription('Sentris backend API specification')
      .setVersion('0.1.0')
      .addServer('/api/v1', 'API v1')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    writeFileSync(outputPath, JSON.stringify(cleanupOpenApiDoc(document), null, 2));
  } finally {
    await app.close();
  }
}

console.log('Generating OpenAPI schema');
generateOpenApi()
  .then(() => {
    console.log('OpenAPI schema generated successfully');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Failed to generate OpenAPI schema', error);
    process.exit(1);
  });
