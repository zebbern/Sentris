/**
 * Security-relevant MCP servers to badge as "featured" in the registry catalog.
 */
export const FEATURED_SERVERS = new Set<string>([
  'github',
  'gitlab',
  'aws-kb-retrieval',
  'elasticsearch',
  'grafana',
  'kubernetes',
  'docker',
  'cloudflare',
  'sentry',
  'snyk',
  'datadog',
  'pagerduty',
]);

/** GitHub API configuration */
export const GITHUB_API_BASE = 'https://api.github.com';
export const DEFAULT_REGISTRY_REPO = 'docker/mcp-registry';
export const RAW_CONTENT_BASE = 'https://raw.githubusercontent.com';

/** Sync settings */
export const SYNC_BATCH_SIZE = 10;
export const RATE_LIMIT_THRESHOLD = 50;
export const MAX_YAML_SIZE_BYTES = 512 * 1024; // 512 KB
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
