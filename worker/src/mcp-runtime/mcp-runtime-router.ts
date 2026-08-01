import {
  McpCatalogSchema,
  McpRuntimeAcquisitionSchema,
  McpRuntimeHealthSchema,
  McpRuntimeHolderIdSchema,
  McpRuntimeKeySchema,
  McpRuntimeRefSchema,
  type McpCatalog,
  type McpRuntimeAcquisition,
  type McpRuntimeHolderId,
  type McpRuntimeHealth,
  type McpRuntimeKey,
  type McpRuntimeRef,
} from '@sentris/shared';

import type { NormalizedMcpResult } from './mcp-client-adapter';
import type { McpOperationContext } from './mcp-client-adapter.types';
import {
  McpRuntimeFenceLostError,
  McpRuntimeManager,
  McpRuntimeUnavailableError,
} from './mcp-runtime-manager';
import type { McpReadyRuntimeRef } from './mcp-runtime-record';
import { resolveMcpRuntimeRoutedRequestTimeout } from './mcp-runtime-limits';
import {
  McpRuntimeInternalClient,
  McpRuntimeInternalHttpError,
} from './mcp-runtime-internal.client';

const FAILED_RETAIN_RELEASE_TIMEOUT_MS = 5_000;

export interface McpRuntimeSerializedOperationContext {
  idleTimeoutMs: number;
  maxTotalTimeoutMs: number;
}

export type McpRuntimeOperation =
  | { kind: 'discover' }
  | {
      kind: 'invoke';
      name: string;
      args: Record<string, unknown>;
      context: McpRuntimeSerializedOperationContext;
    }
  | {
      kind: 'read';
      uri: string;
      context: McpRuntimeSerializedOperationContext;
    }
  | {
      kind: 'get-prompt';
      name: string;
      args: Record<string, string>;
      context: McpRuntimeSerializedOperationContext;
    }
  | { kind: 'touch' }
  | { kind: 'renew' }
  | { kind: 'release' }
  | { kind: 'health' };

export type McpRuntimeOperationResult<T extends McpRuntimeOperation> = T['kind'] extends 'discover'
  ? McpCatalog
  : T['kind'] extends 'touch' | 'renew'
    ? McpRuntimeRef
    : T['kind'] extends 'release'
      ? undefined
      : T['kind'] extends 'health'
        ? McpRuntimeHealth
        : NormalizedMcpResult;

export class McpRuntimeRouter {
  constructor(
    private readonly manager: McpRuntimeManager,
    private readonly internalClient: McpRuntimeInternalClient,
  ) {}

  async acquire(
    runtimeKeyInput: McpRuntimeKey,
    holderIdInput: McpRuntimeHolderId,
    signal?: AbortSignal,
  ): Promise<McpRuntimeAcquisition> {
    const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyInput);
    const holderId = McpRuntimeHolderIdSchema.parse(holderIdInput);
    const ref = McpRuntimeRefSchema.parse(
      await this.manager.acquire(runtimeKey, this.manager.processIdentity, signal),
    );
    if (ref.state !== 'ready') {
      throw new McpRuntimeUnavailableError('MCP runtime acquisition did not resolve ready');
    }
    if (this.isLocalOwner(ref)) {
      this.manager.retain(ref.fence, holderId);
    } else {
      try {
        const payload = await this.internalClient.post<unknown>(
          ref.ownerAddress,
          '/mcp-runtime/retain',
          { fence: ref.fence, holderId },
          signal ?? new AbortController().signal,
        );
        if (
          typeof payload !== 'object' ||
          payload === null ||
          (payload as { retained?: unknown }).retained !== true
        ) {
          throw new Error('MCP runtime owner returned an invalid retain response');
        }
      } catch (error: unknown) {
        if (!(error instanceof McpRuntimeInternalHttpError)) {
          await this.releaseAmbiguousRemoteHolder(ref, holderId);
        }
        throw translateRemoteError(error);
      }
    }
    return McpRuntimeAcquisitionSchema.parse({ ref, holderId });
  }

  private async releaseAmbiguousRemoteHolder(
    ref: McpReadyRuntimeRef,
    holderId: McpRuntimeHolderId,
  ): Promise<void> {
    try {
      await this.internalClient.post<unknown>(
        ref.ownerAddress,
        '/mcp-runtime/release',
        { fence: ref.fence, holderId },
        AbortSignal.timeout(FAILED_RETAIN_RELEASE_TIMEOUT_MS),
        FAILED_RETAIN_RELEASE_TIMEOUT_MS,
      );
    } catch {
      // The original retain failure remains primary; retrying with the same holder is idempotent.
    }
  }

  async execute<T extends McpRuntimeOperation>(
    acquisitionInput: McpRuntimeAcquisition,
    operation: T,
    signal: AbortSignal,
  ): Promise<McpRuntimeOperationResult<T>> {
    const acquisition = McpRuntimeAcquisitionSchema.parse(acquisitionInput);
    const { ref, holderId } = acquisition;

    if (this.isLocalOwner(ref)) {
      return this.executeLocal(ref, holderId, operation, signal);
    }

    try {
      return await this.executeRemote(ref, holderId, operation, signal);
    } catch (error: unknown) {
      throw translateRemoteError(error);
    }
  }

  private isLocalOwner(ref: McpReadyRuntimeRef): boolean {
    return (
      ref.fence.ownerId === this.manager.processIdentity.ownerId &&
      ref.fence.ownerEpoch === this.manager.processIdentity.ownerEpoch &&
      ref.ownerAddress === this.manager.processIdentity.ownerAddress
    );
  }

  private async executeLocal<T extends McpRuntimeOperation>(
    ref: McpReadyRuntimeRef,
    holderId: string,
    operation: T,
    signal: AbortSignal,
  ): Promise<McpRuntimeOperationResult<T>> {
    const context = operationContext(operation, signal);
    switch (operation.kind) {
      case 'discover':
        return (await this.manager.discover(ref.fence, holderId)) as McpRuntimeOperationResult<T>;
      case 'invoke':
        return (await this.manager.invoke(
          ref.fence,
          holderId,
          operation.name,
          operation.args,
          context,
        )) as McpRuntimeOperationResult<T>;
      case 'read':
        return (await this.manager.read(
          ref.fence,
          holderId,
          operation.uri,
          context,
        )) as McpRuntimeOperationResult<T>;
      case 'get-prompt':
        return (await this.manager.getPrompt(
          ref.fence,
          holderId,
          operation.name,
          operation.args,
          context,
        )) as McpRuntimeOperationResult<T>;
      case 'touch':
        return this.manager.touch(ref.fence, holderId) as McpRuntimeOperationResult<T>;
      case 'renew':
        return (await this.manager.renew(ref.fence, holderId)) as McpRuntimeOperationResult<T>;
      case 'release':
        await this.manager.release(ref.fence, holderId);
        return undefined as McpRuntimeOperationResult<T>;
      case 'health':
        return (await this.manager.health(ref.fence, holderId)) as McpRuntimeOperationResult<T>;
    }
  }

  private async executeRemote<T extends McpRuntimeOperation>(
    ref: McpReadyRuntimeRef,
    holderId: string,
    operation: T,
    signal: AbortSignal,
  ): Promise<McpRuntimeOperationResult<T>> {
    const ownerAddress = ref.ownerAddress;
    const path = `/mcp-runtime/${operationPath(operation.kind)}`;
    const body = { fence: ref.fence, holderId, ...operationBody(operation) };
    const payload =
      'context' in operation
        ? await this.internalClient.post<unknown>(
            ownerAddress,
            path,
            body,
            signal,
            resolveMcpRuntimeRoutedRequestTimeout(operation.context),
          )
        : await this.internalClient.post<unknown>(ownerAddress, path, body, signal);
    switch (operation.kind) {
      case 'discover':
        return McpCatalogSchema.parse(payload) as McpRuntimeOperationResult<T>;
      case 'touch':
      case 'renew':
        return McpRuntimeRefSchema.parse(payload) as McpRuntimeOperationResult<T>;
      case 'release':
        if (
          typeof payload !== 'object' ||
          payload === null ||
          (payload as { released?: unknown }).released !== true
        ) {
          throw new Error('MCP runtime owner returned an invalid release response');
        }
        return undefined as McpRuntimeOperationResult<T>;
      case 'health':
        return McpRuntimeHealthSchema.parse(payload) as McpRuntimeOperationResult<T>;
      case 'invoke':
      case 'read':
      case 'get-prompt':
        return payload as McpRuntimeOperationResult<T>;
    }
  }
}

function translateRemoteError(error: unknown): unknown {
  if (error instanceof McpRuntimeInternalHttpError && error.status === 409) {
    return new McpRuntimeFenceLostError('MCP runtime owner rejected a stale fence', {
      cause: error,
    });
  }
  return error;
}

function operationPath(kind: McpRuntimeOperation['kind']): string {
  return kind;
}

function operationBody(operation: McpRuntimeOperation): Record<string, unknown> {
  switch (operation.kind) {
    case 'discover':
    case 'touch':
    case 'renew':
    case 'release':
    case 'health':
      return {};
    case 'invoke':
      return { name: operation.name, args: operation.args, context: operation.context };
    case 'read':
      return { uri: operation.uri, context: operation.context };
    case 'get-prompt':
      return { name: operation.name, args: operation.args, context: operation.context };
  }
}

function operationContext(
  operation: McpRuntimeOperation,
  signal: AbortSignal,
): McpOperationContext {
  if (!('context' in operation)) {
    return { signal, idleTimeoutMs: 30_000, maxTotalTimeoutMs: 120_000 };
  }
  return {
    signal,
    idleTimeoutMs: operation.context.idleTimeoutMs,
    maxTotalTimeoutMs: operation.context.maxTotalTimeoutMs,
  };
}
