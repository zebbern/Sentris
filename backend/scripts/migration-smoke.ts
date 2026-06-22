import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { formatDatabaseTarget, getScriptDatabaseTarget } from './lib/script-database-target';

async function main() {
  const databaseTarget = getScriptDatabaseTarget({
    overrideEnvVar: 'MIGRATION_SMOKE_DATABASE_URL',
  });
  const connectionString = databaseTarget.connectionString;

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const migrationsDir = resolve(__dirname, '../drizzle');
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();

  console.log(`🧪 Migration smoke test starting (found ${files.length} files)`);
  console.log(formatDatabaseTarget(databaseTarget));
  console.log(`Connection: ${databaseTarget.redactedConnectionString}`);

  try {
    await client.query('BEGIN');
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`→ Applying ${file}`);
      await client.query(sql);
    }
    await client.query('ROLLBACK');
    console.log('✅ Migration smoke test passed (changes rolled back)');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration smoke test failed');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Migration smoke test encountered an unexpected error');
  console.error(error);
  process.exit(1);
});
