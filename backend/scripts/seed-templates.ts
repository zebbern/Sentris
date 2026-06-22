/**
 * Seed Security Workflow Templates
 *
 * Upserts security workflow templates directly into the active local database.
 * Existing rows are updated by template name so local seed edits can be re-applied.
 *
 * Usage:
 *   cd backend && bun scripts/seed-templates.ts
 *   TEMPLATE_SEED_DATABASE_URL=postgresql://... bun scripts/seed-templates.ts
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  formatDatabaseTarget,
  getScriptDatabaseTarget,
} from '../../scripts/lib/local-script-runtime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TemplateJson {
  _metadata: {
    name: string;
    description?: string;
    category: string;
    tags: string[];
    author: string;
    version: string;
  };
  manifest: Record<string, unknown>;
  graph: { nodes: unknown[]; edges: unknown[] };
  requiredSecrets: { name: string; type: string; description: string }[];
}

async function seedTemplates(): Promise<void> {
  const databaseTarget = getScriptDatabaseTarget({
    overrideEnvVar: 'TEMPLATE_SEED_DATABASE_URL',
  });
  const connectionString = databaseTarget.connectionString;

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  // Read all JSON files from the seed-templates directory
  const seedDir = join(__dirname, 'seed-templates');
  const files = readdirSync(seedDir).filter((f) => f.endsWith('.json'));

  console.log(`\nConnecting to database...`);
  console.log(formatDatabaseTarget(databaseTarget));
  console.log(`Connection: ${databaseTarget.redactedConnectionString}`);
  console.log(`Found ${files.length} template files to seed\n`);

  let inserted = 0;
  let updated = 0;

  try {
    for (const file of files) {
      const content = readFileSync(join(seedDir, file), 'utf-8');
      const tpl: TemplateJson = JSON.parse(content);

      const existing = await client.query('SELECT id FROM templates WHERE name = $1', [
        tpl._metadata.name,
      ]);
      const nodes = Array.isArray(tpl.graph?.nodes) ? tpl.graph.nodes.length : 0;
      const edges = Array.isArray(tpl.graph?.edges) ? tpl.graph.edges.length : 0;

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE templates SET
            description = $1,
            category = $2,
            tags = $3,
            author = $4,
            repository = $5,
            path = $6,
            branch = $7,
            version = $8,
            commit_sha = $9,
            manifest = $10,
            graph = $11,
            required_secrets = $12,
            is_official = $13,
            is_verified = $14,
            is_active = $15,
            updated_at = $16
          WHERE id = $17`,
          [
            tpl._metadata.description || '',
            tpl._metadata.category,
            JSON.stringify(tpl._metadata.tags),
            tpl._metadata.author,
            'sentris/templates',
            `templates/${file}`,
            'main',
            tpl._metadata.version,
            null,
            JSON.stringify(tpl.manifest),
            JSON.stringify(tpl.graph),
            JSON.stringify(tpl.requiredSecrets),
            true,
            true,
            true,
            new Date(),
            existing.rows[0].id,
          ],
        );

        console.log(
          `  Updated "${tpl._metadata.name}" (${tpl._metadata.category}) - ${nodes} nodes, ${edges} edges`,
        );
        updated++;
        continue;
      }

      const id = randomUUID();
      const now = new Date();

      await client.query(
        `INSERT INTO templates (
          id, name, description, category, tags, author,
          repository, path, branch, version, commit_sha,
          manifest, graph, required_secrets,
          popularity, is_official, is_verified, is_active,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14,
          $15, $16, $17, $18,
          $19, $20
        )`,
        [
          id,
          tpl._metadata.name,
          tpl._metadata.description || '',
          tpl._metadata.category,
          JSON.stringify(tpl._metadata.tags),
          tpl._metadata.author,
          'sentris/templates',
          `templates/${file}`,
          'main',
          tpl._metadata.version,
          null,
          JSON.stringify(tpl.manifest),
          JSON.stringify(tpl.graph),
          JSON.stringify(tpl.requiredSecrets),
          0,
          true,
          true,
          true,
          now,
          now,
        ],
      );
      console.log(
        `  Inserted "${tpl._metadata.name}" (${tpl._metadata.category}) - ${nodes} nodes, ${edges} edges`,
      );
      inserted++;
    }

    console.log(`\nDone: ${inserted} inserted, ${updated} updated\n`);
  } catch (err) {
    console.error('Failed to seed templates:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedTemplates();
