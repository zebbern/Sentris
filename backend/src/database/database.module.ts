import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MigrationGuard } from './migration.guard';
import * as schema from './schema';
import type { DatabaseConfig, IngestConfig } from '../config';

export const DRIZZLE_TOKEN = Symbol('DRIZZLE_CONNECTION');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: Pool,
      useFactory: (configService: ConfigService) => {
        const ingest = configService.get<IngestConfig>('ingest')!;
        if (ingest.skipIngestServices) {
          return {
            connect: async () => ({
              query: async () => ({ rows: [] }),
              release: () => {},
            }),
            on: () => {},
          } as unknown as Pool;
        }
        const connectionString = configService.get<DatabaseConfig>('database')!.connectionString;
        if (!connectionString) {
          throw new Error('DATABASE_URL is not set');
        }
        return new Pool({
          connectionString,
          max: Number(process.env.DB_POOL_MAX ?? 20),
          idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? 30_000),
          connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 10_000),
        });
      },
      inject: [ConfigService],
    },
    {
      provide: DRIZZLE_TOKEN,
      useFactory: (pool: Pool, configService: ConfigService) => {
        const ingest = configService.get<IngestConfig>('ingest')!;
        if (ingest.skipIngestServices) {
          // Recursive mock that handles method chaining and awaits
          const createRecursiveMock = (): any => {
            return new Proxy(() => {}, {
              get: (target, prop) => {
                if (prop === 'then') {
                  // When awaited, resolve to empty array (safe for most db queries)
                  return (resolve: any) => resolve([]);
                }
                return createRecursiveMock();
              },
              apply: () => {
                return createRecursiveMock();
              },
            });
          };
          return createRecursiveMock();
        }
        // Pass schema to enable relational query API (db.query.tableName)
        return drizzle(pool, { schema });
      },
      inject: [Pool, ConfigService],
    },
    MigrationGuard,
  ],
  exports: [DRIZZLE_TOKEN],
})
export class DatabaseModule {}
