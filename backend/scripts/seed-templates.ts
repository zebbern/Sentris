/**
 * Seed Security Workflow Templates
 *
 * Inserts 5 security workflow templates directly into the database.
 * Idempotent — skips templates that already exist by name.
 *
 * Usage:
 *   cd backend && bun scripts/seed-templates.ts
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://sentris:sentris@localhost:5433/sentris';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  // Read all JSON files from the seed-templates directory
  const seedDir = join(__dirname, 'seed-templates');
  const files = readdirSync(seedDir).filter((f) => f.endsWith('.json'));

  console.log(`\nConnecting to database...`);
  console.log(`Found ${files.length} template files to seed\n`);

  let inserted = 0;
  let skipped = 0;

  try {
    for (const file of files) {
      const content = readFileSync(join(seedDir, file), 'utf-8');
      const tpl: TemplateJson = JSON.parse(content);

      // Idempotent: skip if already exists
      const existing = await client.query('SELECT id FROM templates WHERE name = $1', [
        tpl._metadata.name,
      ]);

      if (existing.rows.length > 0) {
        console.log(`  ⏭  Skipping "${tpl._metadata.name}" (already exists)`);
        skipped++;
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

      const nodes = Array.isArray(tpl.graph?.nodes) ? tpl.graph.nodes.length : 0;
      const edges = Array.isArray(tpl.graph?.edges) ? tpl.graph.edges.length : 0;
      console.log(
        `  ✅ Inserted "${tpl._metadata.name}" (${tpl._metadata.category}) — ${nodes} nodes, ${edges} edges`,
      );
      inserted++;
    }

    console.log(`\nDone: ${inserted} inserted, ${skipped} skipped\n`);
  } catch (err) {
    console.error('Failed to seed templates:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedTemplates();
