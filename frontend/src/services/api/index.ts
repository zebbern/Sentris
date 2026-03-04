/**
 * API Service — barrel re-export
 *
 * All domain-specific API modules are assembled here into the single `api`
 * object that the rest of the codebase imports.  Existing imports such as
 *   import { api } from '@/services/api'
 *   import { API_BASE_URL, getApiAuthHeaders } from '@/services/api'
 * continue to work without changes.
 */

import { templatesApi } from './templates';
import { workflowsApi } from './workflows';
import { executionsApi } from './executions';
import { componentsApi } from './components';
import { secretsApi } from './secrets';
import { integrationsApi } from './integrations';
import { schedulesApi } from './schedules';
import { apiKeysApi } from './apiKeys';
import { auditLogsApi } from './audit';
import { filesApi } from './files';
import { artifactsApi } from './artifacts';
import { humanInputsApi } from './humanInputs';
import { webhooksApi } from './webhooks';
import { analyticsSettingsApi } from './analytics';
import { findingsApi } from './findings';
import { httpGet, httpPost, httpPut, httpPatch, httpDel } from './client';

export const api = {
  templates: templatesApi,
  workflows: workflowsApi,
  executions: executionsApi,
  components: componentsApi,
  secrets: secretsApi,
  integrations: integrationsApi,
  schedules: schedulesApi,
  apiKeys: apiKeysApi,
  auditLogs: auditLogsApi,
  files: filesApi,
  artifacts: artifactsApi,
  humanInputs: humanInputsApi,
  webhooks: webhooksApi,
  analyticsSettings: analyticsSettingsApi,
  findings: findingsApi,

  // Generic HTTP methods
  get: httpGet,
  post: httpPost,
  put: httpPut,
  patch: httpPatch,
  del: httpDel,
};

// --- Type re-exports (backward compatibility) ---
export type { WorkflowSummary } from './workflows';
export type {
  AnalyticsSettingsResponse,
  UpdateAnalyticsSettingsInput,
  SubscriptionTier,
} from './analytics';
export type {
  FindingItem,
  FindingDetailResponse,
  FindingsResponse,
  FindingsQueryParams,
  FindingsExportParams,
  FindingsStatsResponse,
  FindingsStatsParams,
} from './findings';
export type { ArtifactListFilters } from './artifacts';
export type { UploadedFileResponse } from './files';
export type { TerminalChunkResponse } from './executions';
export type {
  IntegrationProvider,
  IntegrationConnection,
  IntegrationProviderConfiguration,
  OAuthStartResponse,
} from './integrations';

// --- Client utility re-exports ---
export { API_BASE_URL, API_V1_URL, getApiAuthHeaders } from './client';

export default api;
