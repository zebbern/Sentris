/* eslint-disable no-console -- This operator-facing CLI reports its dry-run/apply plan and failures. */
import { Client } from '@opensearch-project/opensearch';
import { config } from 'dotenv';

import {
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_PROPERTIES,
  buildFindingsFinalIngestPipeline,
  buildFindingsReindexPlan,
  buildOrganizationFindingsIndexTemplate,
  buildOrganizationFindingsIndexTemplateName,
  type FindingsReindexPlan,
} from '../src/analytics/findings-index-template';
import {
  reconcileFindingStorageIdIntegrity,
  type FindingStorageIdIntegrityClient,
} from '../src/analytics/finding-storage-integrity';
import {
  buildFindingObservationIndexPattern,
  buildLegacyFindingOrganizationIndexKey,
} from '@sentris/shared/finding-observation-id';

config();

interface FindingsMigrationClient {
  ingest: {
    putPipeline(input: {
      id: string;
      body: ReturnType<typeof buildFindingsFinalIngestPipeline>;
    }): Promise<unknown>;
    getPipeline(input: Record<string, unknown>): Promise<{
      body: Record<string, Record<string, unknown>>;
    }>;
  };
  indices: {
    get(input: Record<string, unknown>): Promise<{ body: Record<string, unknown> }>;
    putIndexTemplate(input: {
      name: string;
      body: ReturnType<typeof buildOrganizationFindingsIndexTemplate>;
    }): Promise<unknown>;
    exists(input: { index: string }): Promise<{ body: boolean }>;
    putMapping(input: {
      index: string;
      body: { properties: typeof FINDINGS_INDEX_PROPERTIES };
    }): Promise<unknown>;
    putSettings(input: {
      index: string;
      body: { 'index.final_pipeline': string };
    }): Promise<unknown>;
    getSettings(input: Record<string, unknown>): Promise<{
      body: Record<string, { settings?: { index?: { uuid?: string; final_pipeline?: string } } }>;
    }>;
    getIndexTemplate(input: Record<string, unknown>): Promise<{
      body: {
        index_templates?: {
          name?: string;
          index_template?: Record<string, unknown>;
        }[];
      };
    }>;
    getMapping(input: Record<string, unknown>): Promise<{
      body: Record<string, { mappings?: Record<string, unknown> }>;
    }>;
    refresh(input: Record<string, unknown>): Promise<unknown>;
  };
  reindex(input: Record<string, unknown>): Promise<{
    body: {
      timed_out?: boolean;
      failures?: unknown[];
      total?: number;
      created?: number;
      updated?: number;
    };
  }>;
}

export interface FindingsMigrationResult {
  applied: boolean;
  plan: FindingsReindexPlan;
  migratedDocuments: number;
}

export async function migrateFindingsIndices(
  client: FindingsMigrationClient,
  organizationId: string,
  apply: boolean,
): Promise<FindingsMigrationResult> {
  const existing = await client.indices.get({
    index: [
      buildFindingObservationIndexPattern(organizationId),
      `security-findings-${buildLegacyFindingOrganizationIndexKey(organizationId)}-*`,
    ],
    allow_no_indices: true,
    ignore_unavailable: true,
    expand_wildcards: ['open', 'closed'],
  });
  const plan = buildFindingsReindexPlan(organizationId, Object.keys(existing.body));

  if (!apply) {
    return { applied: false, plan, migratedDocuments: 0 };
  }

  await client.ingest.putPipeline({
    id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
    body: buildFindingsFinalIngestPipeline(),
  });
  await client.indices.putIndexTemplate({
    name: buildOrganizationFindingsIndexTemplateName(plan.organizationId),
    body: buildOrganizationFindingsIndexTemplate(plan.organizationId),
  });
  const targetExists = await client.indices.exists({ index: plan.targetIndex });
  if (targetExists.body) {
    await client.indices.putSettings({
      index: plan.targetIndex,
      body: { 'index.final_pipeline': FINDINGS_FINAL_INGEST_PIPELINE_ID },
    });
    await client.indices.putMapping({
      index: plan.targetIndex,
      body: { properties: FINDINGS_INDEX_PROPERTIES },
    });
  }

  let migratedDocuments = 0;
  for (const sourceIndex of plan.sourceIndices) {
    const response = await client.reindex({
      wait_for_completion: true,
      refresh: true,
      conflicts: 'proceed',
      body: {
        source: {
          index: sourceIndex,
          query: {
            bool: {
              filter: [{ term: { 'sentris.organization_id': organizationId } }],
            },
          },
        },
        // Preserve any observation already created in the stable index,
        // including newer triage projected after the legacy source was written.
        dest: { index: plan.targetIndex, op_type: 'create' },
      },
    });
    const failures = response.body.failures ?? [];
    if (response.body.timed_out === true || failures.length > 0) {
      throw new Error(
        `Reindex incomplete for ${sourceIndex}: timed_out=${response.body.timed_out === true}, failures=${failures.length}`,
      );
    }
    migratedDocuments += (response.body.created ?? 0) + (response.body.updated ?? 0);
  }

  if (targetExists.body || plan.sourceIndices.length > 0) {
    await reconcileFindingStorageIdIntegrity(
      client as FindingsMigrationClient & FindingStorageIdIntegrityClient,
      plan.organizationId,
    );
  }

  return { applied: true, plan, migratedDocuments };
}

function parseOrganizationId(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith('--organization='));
  if (inline) return inline.slice('--organization='.length);
  const index = args.indexOf('--organization');
  return index >= 0 ? args[index + 1] : process.env.FINDINGS_REINDEX_ORGANIZATION_ID;
}

async function main(): Promise<void> {
  const organizationId = parseOrganizationId(process.argv.slice(2));
  if (!organizationId) {
    throw new Error(
      'Specify --organization <id> or FINDINGS_REINDEX_ORGANIZATION_ID before inspecting or migrating findings',
    );
  }
  if (!process.env.OPENSEARCH_URL) {
    throw new Error('OPENSEARCH_URL is required');
  }
  const apply = process.argv.includes('--apply');
  const client = new Client({
    node: process.env.OPENSEARCH_URL,
    auth:
      process.env.OPENSEARCH_USERNAME && process.env.OPENSEARCH_PASSWORD
        ? {
            username: process.env.OPENSEARCH_USERNAME,
            password: process.env.OPENSEARCH_PASSWORD,
          }
        : undefined,
    ssl: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  console.log(
    `[findings-migration] organization=${organizationId} mode=${apply ? 'apply' : 'dry-run'}`,
  );
  const result = await migrateFindingsIndices(
    client as unknown as FindingsMigrationClient,
    organizationId,
    apply,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!apply) {
    console.log('[findings-migration] Dry run only. Re-run with --apply after reviewing the plan.');
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('[findings-migration] Failed:', error);
    process.exitCode = 1;
  });
}
