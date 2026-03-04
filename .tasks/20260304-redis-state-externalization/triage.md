# Triage: Redis State Externalization

## In-Memory State Inventory

| # | Service | State | Type | Externalizable? |
|---|---------|-------|------|-----------------|
| 1 | McpGatewayController | transports Map, pendingInits Map | Transport/SSE connections | No — live TCP connections, needs sticky sessions |
| 2 | McpGatewayService | servers Map, registeredToolNames Map, externalToolSchemas Map, externalClients Map | MCP protocol objects | No — stateful protocol objects, needs sticky sessions |
| 3 | StudioMcpController | sessions Map | Transport + identity | No — live connections, needs sticky sessions |
| 4 | WorkflowsService | flowContexts Map, flowContextTimestamps Map | Serializable workflow context cache (10-min TTL) | Yes |
| 5 | TerminalArchiveService | archivingRuns Set | Deduplication guard | Yes |
| 6 | AppController | provisioningOrgs Map | Provisioning dedup/lock | Yes |
| 7 | GitHubSyncService | etagCache Map | HTTP ETag cache (30-min sync) | Yes (low priority) |
| 8 | IntegrationsService | providerOverrides Map | DB-loaded config cache | Partial — needs cross-instance cache invalidation |

## EXECUTION_PLAN

| Order | Agent | Task Summary |
|-------|-------|-------------|
| 1 | architect | Design Redis key patterns, TTL policies, namespace conventions, graceful degradation strategy |
| 2a | implementer | Phase 1 — Core: Externalize flowContexts + archivingRuns |
| 2b | implementer | Phase 2 — Distributed locking: Externalize provisioningOrgs |
| 3 | implementer | Phase 3 — Sticky session hardening: instance heartbeat, failover detection |
| 4 | implementer | Phase 4 — Lower priority: etagCache + providerOverrides invalidation |
| 5 | tester | Unit tests for all new Redis-backed services + multi-instance integration test |
| 6a | code-reviewer | Review implementation |
| 6b | arch-reviewer | Review architecture |

## Key Context

- Reference pattern: `SessionRegistryService` — inject ioredis via token, null-safe Redis check, JSON serialize, SET with EX TTL, non-fatal error handling
- Redis key namespace: `sentris:{domain}:{identifier}`
- Multi-instance: Instance-scoped via per-instance DB, Temporal namespace/task queue, Kafka topic suffix
- All externalized state must fall back to in-memory gracefully during Redis outage
