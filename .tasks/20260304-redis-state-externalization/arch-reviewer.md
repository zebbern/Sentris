# Agent: arch-reviewer

## Purpose
Review the overall architecture of the Redis state externalization for soundness, consistency with existing patterns, and future scalability.

## Skills
Load before starting: none

## Subtasks

### Architecture Consistency
- [x] Verify the Redis key namespace convention is consistent across all services and doesn't conflict with existing keys (`mcp:sessions:*`, `mcp:run:*:tools`, `mcp-discovery:*`)
- [x] Verify TTL policies are appropriate for each state type (not too short to cause cache thrashing, not too long to waste memory)
- [x] Verify Redis connection management: how many connections per backend instance? Is connection pooling needed? Does each service create a separate connection?
- [x] Verify the graceful degradation strategy is consistent: all services fall back to in-memory, no service hard-fails on Redis outage

### Design Soundness
- [x] Evaluate the distributed lock strategy for `provisioningOrgs` — is SETNX+TTL sufficient or is Redlock needed? Consider failure modes (lock holder crashes, network partition)
- [x] Evaluate the pub/sub strategy for `providerOverrides` invalidation — is pub/sub fire-and-forget acceptable (missed messages during subscriber downtime)?
- [x] Evaluate the L1/L2 caching strategy for `etagCache` — is write-through correct or should it be write-behind? What about cache coherence?
- [x] Evaluate whether instance heartbeat adds operational value proportional to its complexity

### Scalability & Performance
- [x] Verify Redis key cardinality won't cause issues: how many `sentris:flow-context:*` keys at peak? How many `sentris:etag-cache:*` keys?
- [x] Verify SCAN usage (not KEYS) for any operations that enumerate keys
- [x] Verify Redis data size: FlowContext can include large `WorkflowDefinition` objects — is JSON size within reasonable bounds?
- [x] Evaluate Redis memory impact: estimate total Redis memory consumed by all externalized state

### Multi-Instance Correctness
- [x] Verify that all externalized state works correctly with 2+ backend instances: no split-brain, no lost updates, no stale reads that cause incorrect behavior
- [x] Verify instance heartbeat ID is unique per instance (consider container restarts, PID reuse)
- [x] Verify session registry stale detection correctly identifies dead instances without false positives during normal operations

### Migration & Rollback
- [x] Verify the migration path is zero-downtime: can instances with and without Redis externalization coexist during rolling deployment?
- [x] Verify rollback is simple: removing Redis injection (setting URL to empty) should revert to in-memory behavior
- [x] Verify no database migrations are required (all state is ephemeral cache)

### Security
- [x] Verify no secrets, tokens, or PII are stored in Redis without encryption
- [x] Verify Redis key patterns don't leak organizational information in key names
- [x] Verify pub/sub messages don't contain sensitive data

## Notes
- This is a read-only review. Do not modify source code files.
- Reference the architect's ADR document for design decisions
- Compare against existing Redis usage patterns: `SessionRegistryService`, `ToolRegistryService`, `TerminalStreamService`
- Key concern: FlowContext contains `WorkflowDefinition` which can be large — evaluate whether Redis is the right storage for potentially large serialized objects vs. a simpler cache-key-only approach with DB fallback

## Completion Summary
<!-- Appended by orchestrator after agent completes. Do not fill manually. -->
