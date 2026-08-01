import {
  Client,
  type AuthProvider,
  type InMemoryResponseCacheStore,
  isJSONRPCErrorResponse,
  parseJSONRPCMessage,
  SdkError,
  SdkErrorCode,
  SSEClientTransport,
  type ConnectOptions,
  type FetchLike,
  UnauthorizedError,
} from '@modelcontextprotocol/client';

export interface CapturedHttpResponse {
  status: number;
  body: string;
}

interface SseAuthState {
  unauthorizedSinceSuccess: number;
  refreshInProgress: boolean;
}

/**
 * The frozen SSE bridge is only eligible for an initial HTTP connect rejection.
 * It deliberately has no operation-level retry API.
 */
export function isEligibleSseFallback(response: CapturedHttpResponse | undefined): boolean {
  if (!response || ![400, 404, 405].includes(response.status)) return false;
  if (response.body.trim() === '') return true;
  try {
    return !isJSONRPCErrorResponse(parseJSONRPCMessage(JSON.parse(response.body)));
  } catch {
    return true;
  }
}

export class McpSseCompatibilityAdapter {
  async connect(
    endpoint: URL,
    connectOptions: ConnectOptions,
    cachePartition: string,
    responseCacheStore: InMemoryResponseCacheStore,
    authProvider?: AuthProvider,
    requestInit?: RequestInit,
  ): Promise<Client> {
    const client = this.createClient(cachePartition, responseCacheStore);
    const authState: SseAuthState = {
      unauthorizedSinceSuccess: 0,
      refreshInProgress: false,
    };
    const clonedRequestInit = cloneRequestInit(requestInit);
    const boundedAuthProvider = boundUnauthorizedRefresh(authProvider, authState);
    const fetch = createSseFetch(authState);
    const transport = this.createTransport(endpoint, boundedAuthProvider, clonedRequestInit, fetch);
    const deadline = connectDeadline(connectOptions);
    const deadlineController = new AbortController();
    const signal = connectOptions.signal
      ? AbortSignal.any([connectOptions.signal, deadlineController.signal])
      : deadlineController.signal;
    const timer =
      deadline === undefined
        ? undefined
        : setTimeout(
            () =>
              deadlineController.abort(
                new SdkError(
                  SdkErrorCode.RequestTimeout,
                  `MCP SSE connect timed out after ${deadline}ms`,
                ),
              ),
            deadline,
          );
    try {
      await raceConnectAgainstAbort(
        client.connect(transport, { ...connectOptions, signal }),
        signal,
        transport,
      );
      return client;
    } catch (error: unknown) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  protected createClient(
    cachePartition: string,
    responseCacheStore: InMemoryResponseCacheStore,
  ): Client {
    return new Client(
      { name: 'sentris-worker-mcp-runtime', version: '1.0.0' },
      {
        capabilities: {},
        versionNegotiation: { mode: 'auto' },
        listMaxPages: 64,
        cachePartition,
        responseCacheStore,
        inputRequired: { autoFulfill: false },
      },
    );
  }

  protected createTransport(
    endpoint: URL,
    authProvider?: AuthProvider,
    requestInit?: RequestInit,
    fetch?: FetchLike,
  ): SSEClientTransport {
    return new SSEClientTransport(endpoint, { authProvider, requestInit, fetch });
  }
}

function cloneRequestInit(requestInit: RequestInit | undefined): RequestInit | undefined {
  if (!requestInit) return undefined;
  return {
    ...requestInit,
    ...(requestInit.headers === undefined ? {} : { headers: new Headers(requestInit.headers) }),
  };
}

function boundUnauthorizedRefresh(
  authProvider: AuthProvider | undefined,
  state: SseAuthState,
): AuthProvider | undefined {
  if (!authProvider) return undefined;
  return {
    token: () => authProvider.token(),
    ...(authProvider.onUnauthorized === undefined
      ? {}
      : {
          onUnauthorized: async (context) => {
            if (state.unauthorizedSinceSuccess >= 1) {
              throw new UnauthorizedError('MCP SSE authentication failed after one refresh retry');
            }
            state.unauthorizedSinceSuccess += 1;
            state.refreshInProgress = true;
            try {
              await authProvider.onUnauthorized!(context);
            } finally {
              state.refreshInProgress = false;
            }
          },
        }),
  };
}

function createSseFetch(state: SseAuthState): FetchLike {
  return async (request, init) => {
    const response = await globalThis.fetch(request, init);
    if (response.ok && !state.refreshInProgress) state.unauthorizedSinceSuccess = 0;
    return response;
  };
}

function connectDeadline(options: ConnectOptions): number | undefined {
  const candidates = [options.timeout, options.maxTotalTimeout].filter(
    (value): value is number => value !== undefined && Number.isFinite(value) && value > 0,
  );
  return candidates.length === 0 ? undefined : Math.min(...candidates);
}

async function raceConnectAgainstAbort(
  connection: Promise<void>,
  signal: AbortSignal,
  transport: SSEClientTransport,
): Promise<void> {
  if (signal.aborted) {
    await transport.close().catch(() => {});
    throw abortReason(signal);
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(abortReason(signal));
      void transport.close().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([connection, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('MCP SSE connect aborted', 'AbortError');
}
