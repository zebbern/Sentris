/**
 * Documentation URL constants derived from docs/docs.json navigation structure.
 * Uses relative paths from the Mintlify-hosted docs site.
 */

/** Base URL for the hosted documentation site. */
export const DOCS_BASE_URL = 'https://docs.sentris.io';

/** Pre-built documentation page URLs for use with PageToolbar helpUrl. */
export const DOCS_URLS = {
  quickstart: `${DOCS_BASE_URL}/quickstart`,
  userGuide: `${DOCS_BASE_URL}/user-guide`,
  secretsManagement: `${DOCS_BASE_URL}/guides/secrets-management`,
  mcpLibrary: `${DOCS_BASE_URL}/mcp-library`,
  humanInTheLoop: `${DOCS_BASE_URL}/architecture/human-in-the-loop`,
  workflowExecution: `${DOCS_BASE_URL}/workflows/execution-status`,
  architecture: `${DOCS_BASE_URL}/architecture`,
  auditLogging: `${DOCS_BASE_URL}/audit-logging`,
  components: `${DOCS_BASE_URL}/components/overview`,
} as const;
