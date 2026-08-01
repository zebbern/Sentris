import Redis from 'ioredis';

import {
  MCP_RUNTIME_BEGIN_DRAIN_LUA,
  MCP_RUNTIME_COMPARE_AND_DELETE_LUA,
  MCP_RUNTIME_PUBLISH_READY_LUA,
  MCP_RUNTIME_RENEW_LUA,
  MCP_RUNTIME_RESERVE_LUA,
} from './mcp-runtime-lease.scripts';

type RedisScriptArgument = string | number | Buffer;
type DefinedScript = (...args: RedisScriptArgument[]) => Promise<unknown>;

interface McpRuntimeScriptRedis extends Redis {
  sentrisMcpRuntimeReserveV1: DefinedScript;
  sentrisMcpRuntimePublishReadyV1: DefinedScript;
  sentrisMcpRuntimeRenewV1: DefinedScript;
  sentrisMcpRuntimeBeginDrainV1: DefinedScript;
  sentrisMcpRuntimeCompareAndDeleteV1: DefinedScript;
}

export interface McpRuntimeRedisCommands {
  reserve(
    leaseKey: string,
    generationKey: string,
    ownerIndexKey: string,
    runtimeKeyHash: string,
    candidateRuntimeId: string,
    ownerId: string,
    ownerEpoch: string,
    retainedOwnerAddress: string,
    runtimeKeyJson: string,
    startingTtlMs: number,
  ): Promise<unknown>;
  publishReady(
    leaseKey: string,
    ownerIndexKey: string,
    runtimeKeyHash: string,
    runtimeId: string,
    ownerId: string,
    ownerEpoch: string,
    leaseGeneration: number,
    ownerAddress: string,
    protocolEra: string,
    protocolVersion: string,
    capabilityFingerprint: string,
    readyTtlMs: number,
  ): Promise<unknown>;
  renew(
    leaseKey: string,
    ownerIndexKey: string,
    runtimeKeyHash: string,
    runtimeId: string,
    ownerId: string,
    ownerEpoch: string,
    leaseGeneration: number,
    readyTtlMs: number,
  ): Promise<unknown>;
  beginDrain(
    leaseKey: string,
    ownerIndexKey: string,
    runtimeKeyHash: string,
    runtimeId: string,
    ownerId: string,
    ownerEpoch: string,
    leaseGeneration: number,
  ): Promise<unknown>;
  compareAndDelete(
    leaseKey: string,
    ownerIndexKey: string,
    runtimeKeyHash: string,
    runtimeId: string,
    ownerId: string,
    ownerEpoch: string,
    leaseGeneration: number,
  ): Promise<unknown>;
}

export function defineMcpRuntimeRedisCommands(redis: Redis): McpRuntimeRedisCommands {
  redis.defineCommand('sentrisMcpRuntimeReserveV1', {
    numberOfKeys: 3,
    lua: MCP_RUNTIME_RESERVE_LUA,
  });
  redis.defineCommand('sentrisMcpRuntimePublishReadyV1', {
    numberOfKeys: 2,
    lua: MCP_RUNTIME_PUBLISH_READY_LUA,
  });
  redis.defineCommand('sentrisMcpRuntimeRenewV1', {
    numberOfKeys: 2,
    lua: MCP_RUNTIME_RENEW_LUA,
  });
  redis.defineCommand('sentrisMcpRuntimeBeginDrainV1', {
    numberOfKeys: 2,
    lua: MCP_RUNTIME_BEGIN_DRAIN_LUA,
  });
  redis.defineCommand('sentrisMcpRuntimeCompareAndDeleteV1', {
    numberOfKeys: 2,
    lua: MCP_RUNTIME_COMPARE_AND_DELETE_LUA,
  });

  const scripts = redis as McpRuntimeScriptRedis;
  return {
    reserve: (...args: Parameters<McpRuntimeRedisCommands['reserve']>) =>
      scripts.sentrisMcpRuntimeReserveV1(...args),
    publishReady: (...args: Parameters<McpRuntimeRedisCommands['publishReady']>) =>
      scripts.sentrisMcpRuntimePublishReadyV1(...args),
    renew: (...args: Parameters<McpRuntimeRedisCommands['renew']>) =>
      scripts.sentrisMcpRuntimeRenewV1(...args),
    beginDrain: (...args: Parameters<McpRuntimeRedisCommands['beginDrain']>) =>
      scripts.sentrisMcpRuntimeBeginDrainV1(...args),
    compareAndDelete: (...args: Parameters<McpRuntimeRedisCommands['compareAndDelete']>) =>
      scripts.sentrisMcpRuntimeCompareAndDeleteV1(...args),
  };
}

export function createMcpRuntimeRedisClient(redisUrl: string, commandTimeoutMs: number): Redis {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('MCP runtime Redis URL must use redis:// or rediss://');
  }
  if (!Number.isInteger(commandTimeoutMs) || commandTimeoutMs <= 0) {
    throw new Error('MCP runtime Redis command timeout must be a positive integer');
  }

  return new Redis(redisUrl, {
    autoResendUnfulfilledCommands: false,
    commandTimeout: commandTimeoutMs,
    connectTimeout: commandTimeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 50, 1_000),
  });
}
