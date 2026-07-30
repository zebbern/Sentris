import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';
import { getDrizzleDatabaseTarget } from '../scripts/lib/local-script-runtime';

const databaseTarget = getDrizzleDatabaseTarget({
  overrideEnvVar: 'DRIZZLE_DATABASE_URL',
});

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema',
  out: './migrations',
  dbCredentials: {
    url: databaseTarget.connectionString,
  },
});
