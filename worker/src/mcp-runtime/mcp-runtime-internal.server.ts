import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  McpRuntimeAcquireRequestSchema,
  McpRuntimeFenceSchema,
  McpRuntimeHolderIdSchema,
} from '@sentris/shared';
import { z } from 'zod';

import {
  isValidMcpRuntimeInternalToken,
  MCP_RUNTIME_INTERNAL_AUTH_HEADER,
  requireMcpRuntimeInternalToken,
} from './mcp-runtime-auth';
import {
  McpRuntimeAmbiguousError,
  McpRuntimeFenceError,
  McpRuntimeManager,
  McpRuntimeUnavailableError,
} from './mcp-runtime-manager';
import {
  MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS,
  MCP_RUNTIME_ROUTED_OPERATION_OVERHEAD_MS,
  resolveMcpRuntimeRoutedRequestTimeout,
} from './mcp-runtime-limits';
import { InputRequiredUnsupportedError } from './mcp-client-adapter';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9301;
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const OperationContextSchema = z
  .object({
    idleTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000),
    maxTotalTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1_000),
  })
  .strict()
  .refine((context) => context.idleTimeoutMs <= context.maxTotalTimeoutMs, {
    message: 'Idle timeout must not exceed total timeout',
  });
const HolderFenceShape = {
  fence: McpRuntimeFenceSchema,
  holderId: McpRuntimeHolderIdSchema,
} as const;
const HolderFenceBodySchema = z.object(HolderFenceShape).strict();
const InvokeBodySchema = z
  .object({
    ...HolderFenceShape,
    name: z.string().min(1).max(1_024),
    args: z.record(z.string(), z.unknown()),
    context: OperationContextSchema,
  })
  .strict();
const ReadBodySchema = z
  .object({
    ...HolderFenceShape,
    uri: z
      .string()
      .min(1)
      .max(64 * 1_024),
    context: OperationContextSchema,
  })
  .strict();
const PromptBodySchema = z
  .object({
    ...HolderFenceShape,
    name: z.string().min(1).max(1_024),
    args: z.record(z.string(), z.string()),
    context: OperationContextSchema,
  })
  .strict();

export interface McpRuntimeInternalServerLogger {
  info(entry: Record<string, unknown>): void;
  error(entry: Record<string, unknown>): void;
}

export interface McpRuntimeInternalServerOptions {
  manager: McpRuntimeManager;
  token: string;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  operationTimeoutOverheadMs?: number;
  logger?: McpRuntimeInternalServerLogger;
}

export interface McpRuntimeInternalServerHandle {
  host: string;
  port: number;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

export function startMcpRuntimeInternalServer(
  options: McpRuntimeInternalServerOptions,
): Promise<McpRuntimeInternalServerHandle> {
  const token = requireMcpRuntimeInternalToken(options.token);
  const host = options.host ?? DEFAULT_HOST;
  const port = validPort(options.port ?? DEFAULT_PORT);
  const maxBodyBytes = positiveInteger(
    options.maxBodyBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    'body limit',
    16 * 1024 * 1024,
  );
  const requestTimeoutMs = positiveInteger(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    'request timeout',
    24 * 60 * 60 * 1_000,
  );
  const operationTimeoutOverheadMs = nonNegativeInteger(
    options.operationTimeoutOverheadMs ?? MCP_RUNTIME_ROUTED_OPERATION_OVERHEAD_MS,
    'operation timeout overhead',
    MCP_RUNTIME_MAX_ROUTED_OPERATION_OVERHEAD_MS,
  );
  const logger = options.logger ?? consoleLogger;
  let listenerError: Error | undefined;
  const server = createServer(
    createRequestHandler({
      manager: options.manager,
      token,
      maxBodyBytes,
      requestTimeoutMs,
      operationTimeoutOverheadMs,
      logger,
    }),
  );
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, 60_000);

  return new Promise((resolve, reject) => {
    const onStartupError = (error: Error) => reject(error);
    server.once('error', onStartupError);
    server.listen(port, host, () => {
      server.removeListener('error', onStartupError);
      server.on('error', (error) => {
        listenerError = error;
        logger.error({ event: 'mcp-runtime-listener-error', error: publicErrorName(error) });
      });
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      let closeFlight: Promise<void> | undefined;
      resolve({
        host,
        port: boundPort,
        async checkReadiness() {
          if (listenerError) {
            throw new Error('MCP runtime owner listener reported an error', {
              cause: listenerError,
            });
          }
          if (!server.listening) throw new Error('MCP runtime owner listener is not listening');
        },
        close() {
          closeFlight ??= closeServer(server);
          return closeFlight;
        },
      });
    });
  });
}

interface HandlerDependencies {
  manager: McpRuntimeManager;
  token: string;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  operationTimeoutOverheadMs: number;
  logger: McpRuntimeInternalServerLogger;
}

function createRequestHandler(deps: HandlerDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const startedAt = Date.now();
    const requestId = requestIdFor(request);
    let status = 500;
    try {
      if (request.method !== 'POST') {
        status = 405;
        sendJson(response, status, { error: 'Method not allowed', requestId });
        return;
      }
      if (
        !isValidMcpRuntimeInternalToken(
          singleHeader(request.headers[MCP_RUNTIME_INTERNAL_AUTH_HEADER]),
          deps.token,
        )
      ) {
        status = 401;
        sendJson(response, status, { error: 'Internal authentication required', requestId });
        return;
      }

      const route = request.url ? new URL(request.url, 'http://runtime.internal').pathname : '';
      if (!KNOWN_ROUTES.has(route)) {
        status = 404;
        sendJson(response, status, { error: 'Not found', requestId });
        return;
      }
      const body = await readJsonBody(request, deps.maxBodyBytes);
      const operationContext = operationContextForRoute(route, body);
      const routedRequestTimeoutMs = operationContext
        ? resolveMcpRuntimeRoutedRequestTimeout(operationContext, deps.operationTimeoutOverheadMs)
        : deps.requestTimeoutMs;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('MCP runtime owner request timed out')),
        routedRequestTimeoutMs,
      );
      const abort = () => controller.abort(new Error('MCP runtime owner caller disconnected'));
      request.once('aborted', abort);
      try {
        const result = await dispatchRoute(deps.manager, route, body, controller.signal);
        status = 200;
        sendJson(response, status, result, requestId);
      } finally {
        clearTimeout(timeout);
        request.removeListener('aborted', abort);
      }
    } catch (error: unknown) {
      const mapped = mapError(error);
      status = mapped.status;
      if (!response.headersSent) {
        sendJson(response, status, { error: mapped.message, code: mapped.code, requestId });
      } else if (!response.writableEnded) {
        response.end();
      }
    } finally {
      deps.logger.info({
        event: 'mcp-runtime-owner-request',
        requestId,
        method: request.method,
        path: safePath(request.url),
        status,
        durationMs: Date.now() - startedAt,
      });
    }
  };
}

const KNOWN_ROUTES = new Set([
  '/mcp-runtime/acquire',
  '/mcp-runtime/retain',
  '/mcp-runtime/discover',
  '/mcp-runtime/invoke',
  '/mcp-runtime/read',
  '/mcp-runtime/get-prompt',
  '/mcp-runtime/touch',
  '/mcp-runtime/renew',
  '/mcp-runtime/release',
  '/mcp-runtime/health',
]);

const OPERATION_ROUTES = new Set([
  '/mcp-runtime/invoke',
  '/mcp-runtime/read',
  '/mcp-runtime/get-prompt',
]);

function operationContextForRoute(
  route: string,
  body: unknown,
): z.infer<typeof OperationContextSchema> | undefined {
  if (!OPERATION_ROUTES.has(route) || typeof body !== 'object' || body === null) return undefined;
  const parsed = OperationContextSchema.safeParse((body as { context?: unknown }).context);
  return parsed.success ? parsed.data : undefined;
}

async function dispatchRoute(
  manager: McpRuntimeManager,
  route: string,
  rawBody: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  switch (route) {
    case '/mcp-runtime/acquire': {
      const body = McpRuntimeAcquireRequestSchema.parse(rawBody);
      return manager.acquire(body.runtimeKey, body.candidateOwner);
    }
    case '/mcp-runtime/retain': {
      const body = HolderFenceBodySchema.parse(rawBody);
      manager.retain(body.fence, body.holderId);
      return { retained: true };
    }
    case '/mcp-runtime/discover': {
      const body = HolderFenceBodySchema.parse(rawBody);
      return manager.discover(body.fence, body.holderId);
    }
    case '/mcp-runtime/invoke': {
      const body = InvokeBodySchema.parse(rawBody);
      return manager.invoke(body.fence, body.holderId, body.name, body.args, {
        ...body.context,
        signal,
      });
    }
    case '/mcp-runtime/read': {
      const body = ReadBodySchema.parse(rawBody);
      return manager.read(body.fence, body.holderId, body.uri, { ...body.context, signal });
    }
    case '/mcp-runtime/get-prompt': {
      const body = PromptBodySchema.parse(rawBody);
      return manager.getPrompt(body.fence, body.holderId, body.name, body.args, {
        ...body.context,
        signal,
      });
    }
    case '/mcp-runtime/touch': {
      const body = HolderFenceBodySchema.parse(rawBody);
      return manager.touch(body.fence, body.holderId);
    }
    case '/mcp-runtime/renew': {
      const body = HolderFenceBodySchema.parse(rawBody);
      return manager.renew(body.fence, body.holderId);
    }
    case '/mcp-runtime/release': {
      const body = HolderFenceBodySchema.parse(rawBody);
      await manager.release(body.fence, body.holderId);
      return { released: true };
    }
    case '/mcp-runtime/health': {
      const body = HolderFenceBodySchema.parse(rawBody);
      return manager.health(body.fence, body.holderId);
    }
    default:
      throw new Error('Unreachable MCP runtime owner route');
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentType = singleHeader(request.headers['content-type']);
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    throw new UnsupportedMediaTypeError();
  }
  const contentLength = singleHeader(request.headers['content-length']);
  if (contentLength !== undefined) {
    const parsedLength = Number(contentLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0) throw new InvalidBodyError();
    if (parsedLength > maxBytes) throw new BodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBytes) throw new BodyTooLargeError();
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error: unknown) {
    throw new InvalidBodyError(error);
  }
}

class BodyTooLargeError extends Error {}
class InvalidBodyError extends Error {
  constructor(cause?: unknown) {
    super('Invalid request body', cause === undefined ? undefined : { cause });
  }
}
class UnsupportedMediaTypeError extends Error {}

function mapError(error: unknown): { status: number; message: string; code?: string } {
  if (error instanceof InputRequiredUnsupportedError) {
    return {
      status: 422,
      message: 'MCP server requires interactive input',
      code: 'MCP_INPUT_REQUIRED_UNSUPPORTED',
    };
  }
  if (error instanceof McpRuntimeFenceError) {
    return { status: 409, message: 'MCP runtime fence is stale', code: error.code };
  }
  if (error instanceof McpRuntimeAmbiguousError) {
    return { status: 503, message: 'MCP runtime operation outcome is ambiguous', code: error.code };
  }
  if (error instanceof McpRuntimeUnavailableError) {
    return { status: 503, message: 'MCP runtime is unavailable' };
  }
  if (error instanceof z.ZodError || error instanceof InvalidBodyError) {
    return { status: 400, message: 'Invalid MCP runtime request' };
  }
  if (error instanceof BodyTooLargeError) {
    return { status: 413, message: 'MCP runtime request body is too large' };
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return { status: 415, message: 'Content-Type must be application/json' };
  }
  return { status: 500, message: 'MCP runtime owner request failed' };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId?: string,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...(requestId ? { 'x-request-id': requestId } : {}),
  });
  response.end(payload);
}

function requestIdFor(request: IncomingMessage): string {
  const supplied = singleHeader(request.headers['x-request-id']);
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safePath(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value, 'http://runtime.internal').pathname;
  } catch {
    return '';
  }
}

function publicErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function validPort(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error('MCP runtime listener port must be between 0 and 65535');
  }
  return value;
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`MCP runtime listener ${label} must be between 1 and ${maximum}`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`MCP runtime listener ${label} must be between 0 and ${maximum}`);
  }
  return value;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
  });
}

const consoleLogger: McpRuntimeInternalServerLogger = {
  info(entry) {
    console.log(JSON.stringify(entry));
  },
  error(entry) {
    console.error(JSON.stringify(entry));
  },
};
