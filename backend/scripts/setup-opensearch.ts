/* eslint-disable no-console -- This setup CLI reports provisioning progress and failures. */
import { Client, type API } from '@opensearch-project/opensearch';
import { config } from 'dotenv';
import { buildAllFindingObservationIndexPattern } from '@sentris/shared/finding-observation-id';
import {
  FINDINGS_FINAL_INGEST_PIPELINE_ID,
  FINDINGS_INDEX_TEMPLATE_VERSION,
  buildFindingsFinalIngestPipeline,
  buildFindingsIndexTemplate,
} from '../src/analytics/findings-index-template';

// Load environment variables
config();

async function main() {
  const url = process.env.OPENSEARCH_URL;
  const username = process.env.OPENSEARCH_USERNAME;
  const password = process.env.OPENSEARCH_PASSWORD;

  if (!url) {
    console.error('❌ OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }

  console.log('🔍 Connecting to OpenSearch...');

  const client = new Client({
    node: url,
    auth: username && password ? { username, password } : undefined,
    ssl: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
    },
  });

  try {
    // Test connection
    const healthCheck = await client.cluster.health();
    console.log(`✅ Connected to OpenSearch cluster (status: ${healthCheck.body.status})`);

    // Apply finding invariants only to canonical observation indexes. Custom
    // analytics suffixes intentionally retain their generic OpenSearch shape.
    const templateName = 'security-findings-template';
    const observationIndexPattern = buildAllFindingObservationIndexPattern();
    console.log(`\n📋 Creating index template: ${templateName}`);

    await client.ingest.putPipeline({
      id: FINDINGS_FINAL_INGEST_PIPELINE_ID,
      // The client declarations require mutable arrays even though request
      // serialization never mutates this deterministic builder output.
      body: buildFindingsFinalIngestPipeline() as unknown as API.Ingest_PutPipeline_RequestBody,
    });

    await client.indices.putIndexTemplate({
      name: templateName,
      // OpenSearch accepts boolean `dynamic`; the generated client declaration
      // is narrower than the wire contract used by the verified template.
      body: buildFindingsIndexTemplate([
        observationIndexPattern,
      ]) as unknown as API.Indices_PutIndexTemplate_RequestBody,
    });

    console.log(`✅ Index template '${templateName}' created successfully`);
    console.log('\n📊 Template configuration:');
    console.log(`  - Index pattern: ${observationIndexPattern}`);
    console.log('  - Shards: 1, Replicas: 1');
    console.log(`  - Template version: ${FINDINGS_INDEX_TEMPLATE_VERSION}`);
    console.log('  - Mappings: canonical observation fields and exact sentris.triage fields');
    console.log(
      '              root: scanner, severity, finding_hash, finding_id, contract, asset_key',
    );
    console.log('              sentris.*: organization_id, run_id, workflow_id, workflow_name,');
    console.log('                         scope_id, component_id, node_ref, asset_key (keyword)');
    console.log('\n🎉 OpenSearch setup completed successfully!');
  } catch (error) {
    console.error('❌ OpenSearch setup failed');
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error during OpenSearch setup');
  console.error(error);
  process.exit(1);
});
