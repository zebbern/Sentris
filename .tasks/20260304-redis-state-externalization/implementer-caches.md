# Agent: implementer-caches

## Purpose
Externalize `etagCache` (GitHubSyncService) to Redis and add cross-instance cache invalidation for `providerOverrides` (IntegrationsService).

## Skills
Load before starting: none

## Subtasks

### ETag Cache Service
- [x] Create `backend/src/templates/etag-cache.service.ts` following the `SessionRegistryService` pattern
- [x] Implement `get(url: string): Promise<CachedResponse<unknown> | null>` — GET the Redis key, parse JSON, return cached ETag + data
- [x] Implement `set(url: string, etag: string, data: unknown): Promise<void>` — SET with JSON serialization and TTL (35 min, slightly exceeding the 30-min sync interval)
- [x] Implement `delete(url: string): Promise<void>` — DEL the key
- [x] Use Redis key pattern: `sentris:etag-cache:{sha256(url)}` — hash the URL to avoid key-length issues and special characters
- [x] Implement `onModuleDestroy()` — call `redis?.quit()`
- [x] When Redis is unavailable (null), fall back to returning null (each instance caches independently in-memory as before)

### Integrate EtagCacheService into GitHubSyncService
- [x] Add `EtagCacheService` as a constructor dependency in `GitHubSyncService`
- [x] Modify `fetchDirectory()` (line ~170): replace `this.etagCache.get(url)` with `EtagCacheService.get(url)`, fallback to local Map
- [x] Modify `fetchDirectory()` ETag storage (line ~210): write-through to both `EtagCacheService.set()` and local Map
- [x] Modify `fetchFileContent()` (line ~227): same pattern — read from Redis first, fallback to local, write-through on update
- [x] Modify `fetchFileContent()` ETag storage (line ~265): write-through to Redis + local Map
- [x] Keep the local `etagCache` Map as a hot L1 cache — Redis is L2 shared across instances
- [x] Ensure all Redis calls are wrapped in try/catch with warn-level logging (non-fatal)

### Provider Overrides Cache Invalidation
- [x] Add version-counter polling to `IntegrationsService` for cross-instance cache invalidation (ADR overrides pub/sub approach — version-counter is simpler and self-healing)
- [x] Single Redis connection — version-counter polling uses regular GET/INCR commands, no pub/sub needed
- [x] Poll `sentris:provider-overrides:version` every 30s on module init
- [x] When `providerOverrides` are updated locally (after `upsertProviderConfiguration()` or `deleteProviderConfiguration()`), INCR the version counter
- [x] On detecting version change during poll, call `reloadProviderOverrides()` to refresh the local Map from DB
- [x] N/A — version-counter approach is stateless, no instanceId filtering needed
- [x] When Redis is unavailable, the service works exactly as before (local cache only, manual restart to sync across instances)

### Module Wiring
- [x] Register `EtagCacheService` in `TemplatesModule` with Redis provider factory
- [x] Add Redis provider token to `IntegrationsModule` for version-counter polling
- [x] Wire `OnModuleInit` for version polling and `OnModuleDestroy` for interval cleanup + quit

## Notes
- The `etagCache` Map in `GitHubSyncService` stores `CachedResponse<unknown>` where the `data` field can be `GitHubFile[]` or `string` depending on the fetch method — Redis serialization handles both since they're JSON-safe
- The URL used as the Map key (e.g., `https://api.github.com/repos/owner/repo/contents/path?ref=branch`) can be very long — hashing to SHA-256 for Redis keys avoids 512-byte key limit concerns
- `IntegrationsService.reloadProviderOverrides()` is a private method that reads from DB — it's already implemented and can be called on invalidation
- ioredis pub/sub requires a dedicated connection — the subscriber connection cannot be used for regular commands. Create two separate Redis instances in the module provider.
- `GitHubSyncService` syncs every 30 minutes — a 35-min TTL on ETag keys means keys expire slightly after the next sync, preventing stale cache from persisting
- `providerOverrides` is loaded once on startup (`onModuleInit`) and when explicitly updated — the invalidation channel is the only new refresh trigger

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
