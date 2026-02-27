import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  connectionString: string | undefined;
}

export const databaseConfig = registerAs<DatabaseConfig>('database', () => ({
  connectionString: process.env.DATABASE_URL,
}));
