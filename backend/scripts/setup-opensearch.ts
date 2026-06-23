import { Client } from '@opensearch-project/opensearch';
import { config } from 'dotenv';

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

    // Create index template for security-findings-*
    const templateName = 'security-findings-template';
    console.log(`\n📋 Creating index template: ${templateName}`);

    await client.indices.putIndexTemplate({
      name: templateName,
      body: {
        index_patterns: ['security-findings-*'],
        template: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              // Root-level analytics fields
              scanner: { type: 'keyword' },
              severity: { type: 'keyword' },
              finding_hash: { type: 'keyword' },
              asset_key: { type: 'keyword' },
              // Workflow context under sentris namespace
              sentris: {
                type: 'object',
                dynamic: 'true',
                properties: {
                  organization_id: { type: 'keyword' },
                  run_id: { type: 'keyword' },
                  workflow_id: { type: 'keyword' },
                  workflow_name: { type: 'keyword' },
                  component_id: { type: 'keyword' },
                  node_ref: { type: 'keyword' },
                  asset_key: { type: 'keyword' },
                },
              },
            },
          },
        },
      },
    });

    console.log(`✅ Index template '${templateName}' created successfully`);
    console.log('\n📊 Template configuration:');
    console.log('  - Index pattern: security-findings-*');
    console.log('  - Shards: 1, Replicas: 1');
    console.log('  - Mappings: @timestamp (date)');
    console.log('              root: scanner, severity, finding_hash, asset_key (keyword)');
    console.log('              sentris.*: organization_id, run_id, workflow_id, workflow_name,');
    console.log('                         component_id, node_ref, asset_key (keyword)');
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
