import {
  McpResolvedRuntimeDefinitionSchema,
  McpRuntimeKeySchema,
  type McpResolvedRuntimeDefinition,
  type McpRuntimeKey,
} from '@sentris/shared';

import { buildBackendApiUrl } from '../common/backend-url';
import { requireMcpRuntimeInternalToken } from './mcp-runtime-auth';
import type { McpRuntimeDefinitionResolver } from './mcp-runtime-driver';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface BackendMcpRuntimeDefinitionResolverOptions {
  internalToken: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves secret-bearing MCP configuration only after the local manager wins
 * a lease reservation. The durable workflow and Redis lease carry only the
 * validated, secret-free runtime key.
 */
export class BackendMcpRuntimeDefinitionResolver implements McpRuntimeDefinitionResolver {
  private readonly internalToken: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: BackendMcpRuntimeDefinitionResolverOptions) {
    this.internalToken = requireMcpRuntimeInternalToken(options.internalToken);
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.timeoutMs = positiveTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.env = options.env ?? process.env;
  }

  async resolve(
    runtimeKeyInput: McpRuntimeKey,
    signal: AbortSignal,
  ): Promise<McpResolvedRuntimeDefinition> {
    const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyInput);
    const response = await this.fetchFn(
      buildBackendApiUrl('internal/mcp/runtime-definition', this.env),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.internalToken,
        },
        body: JSON.stringify({ runtimeKey }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      },
    );

    const payload = await readBoundedJson(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      throw new Error(`MCP runtime configuration resolution failed with status ${response.status}`);
    }
    return McpResolvedRuntimeDefinitionSchema.parse(payload);
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      await response.body?.cancel();
      throw new Error('MCP runtime configuration response exceeded the configured limit');
    }
  }
  if (!response.body) throw new Error('MCP runtime configuration response was empty');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('MCP runtime configuration response exceeded the configured limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error: unknown) {
    throw new Error('MCP runtime configuration response was invalid JSON', { cause: error });
  }
}

function positiveTimeout(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 120_000) {
    throw new Error('MCP runtime configuration timeout must be between 1 and 120000ms');
  }
  return value;
}
