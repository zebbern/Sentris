import { z } from 'zod';
import {
  ComponentRetryPolicy,
  componentRegistry,
  defineComponent,
  fromHttpResponse,
  inputs,
  outputs,
  parameters,
  param,
  port,
  ValidationError,
  type ExecutionContext,
} from '@sentris/component-sdk';

const NVD_CVE_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_DOCS_URL = 'https://nvd.nist.gov/developers/vulnerabilities';
const NVD_USER_AGENT = 'SentrisFlow/1.0';
const NVD_MAX_HTTP_ATTEMPTS = 3;
const NVD_TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const cveIdPattern = /^CVE-\d{4}-\d{4,}$/i;

const cveIdsInputSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string()).default([]));

const inputSchema = inputs({
  cveIds: port(cveIdsInputSchema, {
    label: 'CVE IDs',
    description:
      'One or more CVE identifiers. When supplied, these take precedence over keyword search.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  keywordSearch: port(z.string().optional().default(''), {
    label: 'Keyword Search',
    description: 'NVD keyword search used when no CVE IDs are supplied.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  apiKey: port(z.string().optional().default(''), {
    label: 'NVD API Key',
    description: 'Optional NVD API key. Sent as the apiKey request header.',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
});

const parameterSchema = parameters({
  resultsPerPage: param(
    z
      .number()
      .int()
      .min(1)
      .max(2000)
      .default(20)
      .describe('Maximum CVE records to return from NVD.'),
    {
      label: 'Results Per Page',
      editor: 'number',
      min: 1,
      max: 2000,
    },
  ),
  includeRejected: param(
    z.boolean().default(false).describe('Include CVE records marked rejected by NVD.'),
    {
      label: 'Include Rejected CVEs',
      editor: 'boolean',
    },
  ),
  timeoutMs: param(
    z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(30000)
      .describe('Request timeout in milliseconds.'),
    {
      label: 'Timeout (ms)',
      editor: 'number',
      min: 1000,
      max: 120000,
    },
  ),
  failOnUnavailable: param(
    z
      .boolean()
      .default(false)
      .describe('Throw when NVD is unavailable instead of returning warnings.'),
    {
      label: 'Fail On Unavailable',
      editor: 'boolean',
    },
  ),
});

const dataSourceSchema = z.object({
  name: z.literal('nvd'),
  ok: z.boolean(),
  status: z.number(),
  statusText: z.string(),
  url: z.string(),
  docsUrl: z.string(),
});

const querySchema = z.object({
  cveIds: z.array(z.string()),
  keywordSearch: z.string().nullable(),
  resultsPerPage: z.number(),
  includeRejected: z.boolean(),
});

const summarySchema = z.object({
  query: querySchema,
  ok: z.boolean(),
  status: z.number(),
  statusText: z.string(),
  totalResults: z.number(),
  returnedResults: z.number(),
  warnings: z.array(z.string()),
});

const outputSchema = outputs({
  ok: port(z.boolean(), {
    label: 'OK',
    description: 'Whether NVD returned a successful HTTP response and valid JSON.',
  }),
  status: port(z.number(), {
    label: 'HTTP Status',
    description: 'NVD HTTP status code, or 0 for network/timeout failures.',
  }),
  statusText: port(z.string(), {
    label: 'HTTP Status Text',
    description: 'HTTP status text or normalized network failure reason.',
  }),
  url: port(z.string(), {
    label: 'Request URL',
    description: 'The NVD CVE API URL requested by this component.',
  }),
  dataSource: port(dataSourceSchema, {
    label: 'Data Source',
    description: 'NVD source health metadata for downstream reports.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  data: port(z.unknown(), {
    label: 'Raw NVD Data',
    description: 'Raw NVD CVE API response, or an error object when unavailable.',
    allowAny: true,
    reason: 'NVD response fields evolve over time and include nested CVE metadata.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  vulnerabilities: port(z.array(z.unknown()), {
    label: 'Vulnerabilities',
    description: 'NVD vulnerability records from the response body.',
    allowAny: true,
    reason: 'NVD CVE records contain a large schema that may evolve over time.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  totalResults: port(z.number(), {
    label: 'Total Results',
    description: 'NVD totalResults value, or 0 when unavailable.',
  }),
  returnedResults: port(z.number(), {
    label: 'Returned Results',
    description: 'Number of vulnerability records returned in this response.',
  }),
  warnings: port(z.array(z.string()), {
    label: 'Warnings',
    description: 'Non-fatal availability or parsing warnings.',
  }),
  summary: port(summarySchema, {
    label: 'Summary',
    description: 'Query, source health, and result count summary.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

interface NvdCveUrlOptions {
  cveIds: string[];
  keywordSearch?: string | null;
  resultsPerPage: number;
  includeRejected: boolean;
}

const nvdRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 15,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ValidationError', 'AuthenticationError', 'ConfigurationError'],
};

function normalizeCveIds(cveIds: string[]): string[] {
  const normalized = new Set<string>();
  for (const item of cveIds) {
    const cveId = item.trim().toUpperCase();
    if (cveIdPattern.test(cveId)) normalized.add(cveId);
  }
  return Array.from(normalized).slice(0, 100);
}

export function buildNvdCveUrl(options: NvdCveUrlOptions): string {
  const cveIds = normalizeCveIds(options.cveIds);
  const keywordSearch = String(options.keywordSearch ?? '').trim();
  const url = new URL(NVD_CVE_API_URL);

  if (cveIds.length > 0) {
    url.searchParams.set('cveIds', cveIds.join(','));
  } else if (keywordSearch.length > 0) {
    url.searchParams.set('keywordSearch', keywordSearch);
  }

  url.searchParams.set('resultsPerPage', String(options.resultsPerPage));
  url.searchParams.set('startIndex', '0');

  const requestUrl = url.toString();
  return options.includeRejected ? requestUrl : `${requestUrl}&noRejected`;
}

function classifyFetchError(error: unknown): string {
  const name = typeof error === 'object' && error ? String((error as { name?: unknown }).name) : '';
  if (name === 'AbortError') return 'Timeout';

  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|aborted/i.test(message)) return 'Timeout';
  return 'Network Error';
}

function nvdRetryDelayMs(attempt: number): number {
  const configured = Number(process.env.NVD_RETRY_DELAY_MS ?? 1000);
  return Number.isFinite(configured) ? Math.max(0, configured * attempt) : 1000 * attempt;
}

async function waitForNvdRetry(attempt: number): Promise<void> {
  const delayMs = nvdRetryDelayMs(attempt);
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function fallbackResult({
  url,
  query,
  status,
  statusText,
  error,
}: {
  url: string;
  query: z.infer<typeof querySchema>;
  status: number;
  statusText: string;
  error?: string;
}) {
  const warnings = [`NVD CVE query unavailable: ${statusText || status || 'unknown error'}`];
  const dataSource = {
    name: 'nvd' as const,
    ok: false,
    status,
    statusText,
    url,
    docsUrl: NVD_DOCS_URL,
  };

  return {
    ok: false,
    status,
    statusText,
    url,
    dataSource,
    data: { error: error || statusText },
    vulnerabilities: [],
    totalResults: 0,
    returnedResults: 0,
    warnings,
    summary: {
      query,
      ok: false,
      status,
      statusText,
      totalResults: 0,
      returnedResults: 0,
      warnings,
    },
  };
}

async function fetchNvdJson(
  context: Pick<ExecutionContext, 'http'>,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await context.http.fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const definition = defineComponent({
  id: 'sentris.nvd.cve.query',
  label: 'NVD CVE Query',
  category: 'security',
  runner: { kind: 'inline' },
  retryPolicy: nvdRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Query the NVD CVE API by CVE ID or keyword and return raw data with normalized source health metadata.',
  toolProvider: {
    kind: 'component',
    name: 'nvd_cve_query',
    description: 'CVE metadata lookup using the NIST National Vulnerability Database.',
  },
  ui: {
    slug: 'nvd-cve-query',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Look up CVE metadata in NVD by CVE ID or keyword with timeout-safe source status output.',
    documentationUrl: NVD_DOCS_URL,
    icon: 'ShieldAlert',
    author: {
      name: 'SentrisAI',
      type: 'sentris',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Fetch a known CVE such as CVE-2024-3094.',
      'Search for candidate CVEs from a detected service keyword such as nginx.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const cveIds = normalizeCveIds(parsedInputs.cveIds);
    const keywordSearch = parsedInputs.keywordSearch.trim();

    if (cveIds.length === 0 && keywordSearch.length === 0) {
      throw new ValidationError('Provide at least one CVE ID or a keyword search value', {
        fieldErrors: {
          cveIds: ['Provide a CVE ID or keyword search value.'],
          keywordSearch: ['Provide a CVE ID or keyword search value.'],
        },
      });
    }

    const query = {
      cveIds,
      keywordSearch: cveIds.length === 0 ? keywordSearch : null,
      resultsPerPage: parsedParams.resultsPerPage,
      includeRejected: parsedParams.includeRejected,
    };
    const url = buildNvdCveUrl(query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': NVD_USER_AGENT,
    };
    const apiKey = parsedInputs.apiKey.trim();
    if (apiKey.length > 0) headers.apiKey = apiKey;

    context.logger.info(
      `[NVD] Querying CVE API for ${cveIds.length > 0 ? cveIds.join(', ') : keywordSearch}`,
    );
    context.emitProgress({
      message: `Querying NVD CVE API for ${cveIds.length > 0 ? cveIds.join(', ') : keywordSearch}`,
      level: 'info',
    });

    try {
      let response: Response | null = null;
      for (let attempt = 1; attempt <= NVD_MAX_HTTP_ATTEMPTS; attempt++) {
        response = await fetchNvdJson(context, url, headers, parsedParams.timeoutMs);
        if (
          response.ok ||
          !NVD_TRANSIENT_STATUS_CODES.has(response.status) ||
          attempt === NVD_MAX_HTTP_ATTEMPTS
        ) {
          break;
        }

        context.logger.warn(
          `[NVD] Transient HTTP ${response.status}; retrying attempt ${attempt + 1}/${NVD_MAX_HTTP_ATTEMPTS}`,
        );
        await waitForNvdRetry(attempt);
      }

      if (!response) {
        throw new Error('NVD request did not return a response');
      }

      const statusText = response.statusText || `HTTP ${response.status}`;
      if (!response.ok) {
        const text = await response.text();
        if (parsedParams.failOnUnavailable) throw fromHttpResponse(response, text);
        return fallbackResult({
          url,
          query,
          status: response.status,
          statusText,
          error: text || statusText,
        });
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        if (parsedParams.failOnUnavailable) throw error;
        return fallbackResult({
          url,
          query,
          status: response.status,
          statusText: 'Invalid JSON',
          error: error instanceof Error ? error.message : 'Invalid JSON',
        });
      }

      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const vulnerabilities = Array.isArray(record.vulnerabilities) ? record.vulnerabilities : [];
      const totalResults =
        typeof record.totalResults === 'number' ? record.totalResults : vulnerabilities.length;
      const warnings: string[] = [];
      const dataSource = {
        name: 'nvd' as const,
        ok: true,
        status: response.status,
        statusText,
        url,
        docsUrl: NVD_DOCS_URL,
      };

      context.logger.info(`[NVD] Returned ${vulnerabilities.length} CVE record(s)`);

      return {
        ok: true,
        status: response.status,
        statusText,
        url,
        dataSource,
        data,
        vulnerabilities,
        totalResults,
        returnedResults: vulnerabilities.length,
        warnings,
        summary: {
          query,
          ok: true,
          status: response.status,
          statusText,
          totalResults,
          returnedResults: vulnerabilities.length,
          warnings,
        },
      };
    } catch (error) {
      if (parsedParams.failOnUnavailable) throw error;
      const statusText = classifyFetchError(error);
      context.logger.warn(
        `[NVD] CVE query failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallbackResult({
        url,
        query,
        status: 0,
        statusText,
      });
    }
  },
});

componentRegistry.register(definition);

type NvdCveInput = typeof inputSchema;
type NvdCveOutput = typeof outputSchema;

export type { NvdCveInput, NvdCveOutput };
export { definition };
