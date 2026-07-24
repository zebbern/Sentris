# Local Usability — Phase 4: Asset Inventory Auto-Feed — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Automatically extract discovered assets (subdomains/hosts/ports/URLs/IPs/DNS records) from a run's recon-node outputs and upsert them into a per-Target `asset_inventory`, tracked over time; show them on the Target's "Assets" tab.

**Architecture:** Backend post-run ingestion at the node-io chokepoint, decoupled via `EventEmitter2` (mirrors `finding.triage.changed`). After `NodeIORepository.recordCompletion`, emit `asset.nodeio.completed`. `AssetInventoryService` (as an `@OnEvent` listener) recovers `organizationId` from the node_io row and `scopeId` from `workflow_runs` (skip if either absent — explicit-only feed), fetches spilled outputs from object storage, runs a pure extractor (reusing `normalizeFindings` + a ported `detectAssetKey`) over asset-bearing recon components, and upserts into `asset_inventory` with first/last-seen tracking. A read module exposes `GET /scopes/:id/assets`. Extractor failures never break run persistence.

**Tech Stack:** NestJS + Drizzle (drizzle-kit push) + `@nestjs/event-emitter`, MinIO via `StorageService`, `@sentris/shared` normalizeFindings, React + TanStack Query, `bun:test`.

## Global Constraints

- Migrations: `bun run migration:push`. `asset_inventory` follows the `finding-triage` org-scoped augmentation pattern (org `varchar(191).notNull()`, uuid pk, unique index, `$inferSelect/$inferInsert`).
- **Resilience:** the event emit is wrapped in try/catch at the chokepoint; the `@OnEvent` handler wraps its whole body in try/catch and logs — it must NEVER throw into the node-io write path.
- **Explicit-only feed:** attribute assets to a scope ONLY when the run has a non-null `scopeId`. Guard null `organizationId` too (both node_io.organizationId and run.organizationId are nullable).
- **Completion event has no org/workflow ids** — read `organizationId`/`outputs`/spill fields from the persisted `node_io` row (`findByRunAndNode(runId, nodeRef)`), and `scopeId`/`organizationId` from `workflow_runs` (`findByRunId(runId)`).
- **Spill:** if `outputsSpilled && outputsStorageRef`, fetch full outputs via `StorageService.downloadFile(outputsStorageRef)` (mirror `NodeIOService.toDetail`), inside try/catch; else use the row's `outputs` jsonb. Use `isSpilledDataMarker` from `@sentris/component-sdk` to detect a marker.
- **Recon-only:** `RECON_COMPONENT_IDS = new Set(['sentris.subfinder.run','sentris.httpx.scan','sentris.naabu.scan','sentris.dnsx.run','sentris.katana.run','sentris.theharvester.run'])`. Skip non-recon components before touching outputs/spill.
- **Upsert first/last-seen:** on conflict `(organizationId, scopeId, assetType, assetValue)`, `set` bumps `lastSeenAt`/`lastSeenRunId`/`metadata`/`updatedAt` only — NEVER `firstSeenAt`/`firstSeenRunId`.
- No `any` in production. Commit after each task.

## File Structure

Backend (create): `database/schema/assets.ts`; `assets/{assets.module,assets.controller,assets.service,assets.repository}.ts`, `assets/dto/assets.dto.ts`, `assets/asset-extractor.ts` (pure), `assets/asset-key.ts` (ported detectAssetKey), `assets/__tests__/*`. Modify: `database/schema/index.ts`, `app.module.ts`, `node-io/node-io.repository.ts` (or `node-io-ingest.service.ts`) to emit the event, `openapi.json`.
Frontend (create): `services/api/assets.ts`, `hooks/queries` additions. Modify: `types/scopes.ts` (Asset type), `services/api/index.ts`, `lib/queryKeys.ts`, `hooks/queries/useScopeQueries.ts` (add `useTargetAssets`), `pages/target-detail/{targetDetailTypes.ts,useTargetDetail.ts}`, `pages/TargetDetailPage.tsx`, `routes.tsx`.

---

### Task 1: `asset_inventory` schema + Asset types

**Files:** Create `backend/src/database/schema/assets.ts`; modify `backend/src/database/schema/index.ts`; add `Asset` type to `frontend/src/types/scopes.ts`.

- [ ] **Step 1: pgEnum + table** — `assets.ts`:

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { scopes } from './scopes';

export const assetTypeEnum = pgEnum('asset_type', [
  'subdomain',
  'host',
  'ip-address',
  'open-port',
  'http-probe',
  'dns-record',
  'crawled-url',
  'url',
]);

export const assetInventory = pgTable(
  'asset_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 191 }).notNull(),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    assetType: assetTypeEnum('asset_type').notNull(),
    assetValue: varchar('asset_value', { length: 1024 }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    firstSeenRunId: text('first_seen_run_id'),
    lastSeenRunId: text('last_seen_run_id'),
    sourceComponentId: varchar('source_component_id', { length: 191 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('asset_inventory_org_idx').on(table.organizationId),
    scopeIdx: index('asset_inventory_scope_idx').on(table.scopeId),
    dedupUnique: uniqueIndex('asset_inventory_org_scope_type_value_uidx').on(
      table.organizationId,
      table.scopeId,
      table.assetType,
      table.assetValue,
    ),
    scopeLastSeenIdx: index('asset_inventory_scope_lastseen_idx').on(
      table.scopeId,
      table.lastSeenAt,
    ),
  }),
);

export type AssetRecord = typeof assetInventory.$inferSelect;
export type NewAssetRecord = typeof assetInventory.$inferInsert;
```

Append `export * from './assets';` to `schema/index.ts`. Run `cd backend && bun run migration:push` (confirm creates `asset_inventory` + the `asset_type` enum, no destructive prompts). Verify with `docker exec sentris-postgres psql -U sentris -d sentris_instance_0 -c '\d asset_inventory'`.

- [ ] **Step 2: Frontend Asset type** — in `frontend/src/types/scopes.ts` add:

```ts
export type AssetType =
  | 'subdomain'
  | 'host'
  | 'ip-address'
  | 'open-port'
  | 'http-probe'
  | 'dns-record'
  | 'crawled-url'
  | 'url';
export interface Asset {
  id: string;
  organizationId: string;
  scopeId: string;
  assetType: AssetType;
  assetValue: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRunId?: string | null;
  lastSeenRunId?: string | null;
  sourceComponentId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Commit** — `git add backend/src/database/schema/assets.ts backend/src/database/schema/index.ts frontend/src/types/scopes.ts && git commit -m "feat(assets): add asset_inventory schema and Asset type"`

---

### Task 2: Pure asset extractor + asset-key + tests

**Files:** Create `backend/src/assets/asset-key.ts`, `backend/src/assets/asset-extractor.ts`, `backend/src/assets/__tests__/asset-extractor.spec.ts`.

**Interfaces produced:** `deriveAssetKey(finding): string | null`; `extractAssets({ componentId, nodeRef, outputs, runId }): ExtractedAsset[]` where `ExtractedAsset = { assetType: AssetType; assetValue: string; sourceComponentId: string; metadata: Record<string,unknown> }`.

- [ ] **Step 1: asset-key** — port `detectAssetKey` field priority into `asset-key.ts`:

```ts
const ASSET_FIELDS = ['asset_key', 'host', 'domain', 'subdomain', 'url', 'ip', 'asset', 'target'];
export function deriveAssetKeyFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | null {
  if (!metadata) return null;
  for (const field of ASSET_FIELDS) {
    const v = metadata[field];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}
```

- [ ] **Step 2: Failing test** — `asset-extractor.spec.ts` with table-driven cases (mirror real normalizeFindings output shapes). Cover: subfinder → subdomain assets (value = the subdomain string); httpx → http-probe assets (value = url from metadata.url); naabu → open-port assets (value = `host:port` from finding string, metadata has host/port); dnsx → dns-record; katana → crawled-url; theHarvester → subdomain + ip-address; a non-recon componentId (nuclei) → `[]`; within-batch dedup (two identical subdomains → one asset). Example:

```ts
import { describe, it, expect } from 'bun:test';
import { extractAssets } from '../asset-extractor';

describe('extractAssets', () => {
  it('extracts subdomains from subfinder output', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n1',
      runId: 'r1',
      outputs: { subdomains: ['a.example.com', 'b.example.com'] },
    });
    expect(out.map((a) => a.assetType)).toEqual(['subdomain', 'subdomain']);
    expect(out.map((a) => a.assetValue).sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(out[0].sourceComponentId).toBe('sentris.subfinder.run');
  });
  it('extracts http-probe assets with url from metadata', () => {
    const out = extractAssets({
      componentId: 'sentris.httpx.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { responses: [{ url: 'https://x.example.com', statusCode: 200 }] },
    });
    expect(out[0]).toMatchObject({ assetType: 'http-probe', assetValue: 'https://x.example.com' });
  });
  it('returns [] for a non-recon component', () => {
    expect(
      extractAssets({
        componentId: 'sentris.nuclei.scan',
        nodeRef: 'n',
        runId: 'r',
        outputs: { findings: [{}] },
      }),
    ).toEqual([]);
  });
  it('dedupes identical assets within a batch', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['dup.example.com', 'dup.example.com'] },
    });
    expect(out).toHaveLength(1);
  });
  it('extracts open-port assets from naabu', () => {
    const out = extractAssets({
      componentId: 'sentris.naabu.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { findings: [{ host: 'h.example.com', port: 8080, protocol: 'tcp' }] },
    });
    expect(out[0].assetType).toBe('open-port');
    expect(out[0].assetValue).toContain('h.example.com');
  });
});
```

- [ ] **Step 3: Implement `asset-extractor.ts`** — use `normalizeAllFindings` from `@sentris/shared` (import path per how backend imports shared — check an existing backend import of `normalizeFindings`), map its asset-bearing `type` → `AssetType`, derive `assetValue` via `deriveAssetKeyFromMetadata(finding.metadata) ?? finding.finding`, set `sourceComponentId = componentId`, `metadata = finding.metadata ?? {}`; skip non-`RECON_COMPONENT_IDS`; dedup by `${assetType}�${assetValue}`:

```ts
import { normalizeAllFindings, type FindingSeverity } from '@sentris/shared'; // confirm export path
import type { AssetType } from '...'; // reuse the enum union
import { deriveAssetKeyFromMetadata } from './asset-key';

export const RECON_COMPONENT_IDS = new Set([
  'sentris.subfinder.run',
  'sentris.httpx.scan',
  'sentris.naabu.scan',
  'sentris.dnsx.run',
  'sentris.katana.run',
  'sentris.theharvester.run',
]);
const TYPE_MAP: Record<string, AssetType> = {
  subdomain: 'subdomain',
  'ip-address': 'ip-address',
  'http-probe': 'http-probe',
  'open-port': 'open-port',
  'dns-record': 'dns-record',
  'crawled-url': 'crawled-url',
};
export interface ExtractedAsset {
  assetType: AssetType;
  assetValue: string;
  sourceComponentId: string;
  metadata: Record<string, unknown>;
}
export function extractAssets(input: {
  componentId: string;
  nodeRef: string;
  runId: string;
  outputs: Record<string, unknown> | null;
}): ExtractedAsset[] {
  if (!RECON_COMPONENT_IDS.has(input.componentId)) return [];
  const findings = normalizeAllFindings([
    { nodeRef: input.nodeRef, componentId: input.componentId, outputs: input.outputs },
  ]);
  const seen = new Set<string>();
  const out: ExtractedAsset[] = [];
  for (const f of findings) {
    const assetType = TYPE_MAP[f.type];
    if (!assetType) continue;
    const md = (f.metadata ?? {}) as Record<string, unknown>;
    const assetValue = (deriveAssetKeyFromMetadata(md) ?? f.finding ?? '').toString().trim();
    if (!assetValue) continue;
    const key = `${assetType}�${assetValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ assetType, assetValue, sourceComponentId: input.componentId, metadata: md });
  }
  return out;
}
```

(Confirm `@sentris/shared` is the backend import for `normalizeAllFindings` — grep backend for an existing import; adjust the specifier.)

- [ ] **Step 4: Run tests — pass.** `cd backend && bun test src/assets/`
- [ ] **Step 5: Commit** — `git add backend/src/assets/asset-key.ts backend/src/assets/asset-extractor.ts backend/src/assets/__tests__ && git commit -m "feat(assets): add pure recon asset extractor"`

---

### Task 3: Ingestion pipeline + assets read module + tests

**Files:** Create `backend/src/assets/{assets.module,assets.controller,assets.service,assets.repository}.ts`, `assets/dto/assets.dto.ts`, `assets/__tests__/assets.service.spec.ts`. Modify `backend/src/node-io/node-io.repository.ts` (emit event) or `node-io-ingest.service.ts`, `backend/src/app.module.ts`, `openapi.json`.

- [ ] **Step 1: Repository** — `assets.repository.ts`: `@Inject(DRIZZLE_TOKEN) db`. `upsertMany(records: NewAssetRecord[])` doing per-record `insert().onConflictDoUpdate({ target: [org,scopeId,assetType,assetValue], set: { lastSeenAt: now, lastSeenRunId: r.lastSeenRunId, metadata: r.metadata, updatedAt: now } })` — set does NOT include firstSeenAt/firstSeenRunId. `listByScope(scopeId, organizationId, opts?: { assetType?; limit? })` → ordered `desc(lastSeenAt)`, org+scope ANDed, optional assetType filter.

- [ ] **Step 2: Service + emit** — Emit the event: in `node-io.repository.ts` `recordCompletion`, AFTER the upsert, wrap `this.eventEmitter.emit('asset.nodeio.completed', { runId, nodeRef, componentId })` in try/catch (inject `EventEmitter2`). `AssetInventoryService`:
  - `@OnEvent('asset.nodeio.completed', { async: true }) async onNodeIoCompleted(event)` — whole body in try/catch (log, never throw):
    1. `if (!RECON_COMPONENT_IDS.has(event.componentId)) return;`
    2. `const row = await this.nodeIORepository.findByRunAndNode(event.runId, event.nodeRef);` guard null.
    3. `const run = await this.workflowRunRepository.findByRunId(event.runId);` guard `!run?.organizationId || !run?.scopeId` → return (explicit-only + null-org guard).
    4. Resolve outputs: if `row.outputsSpilled && row.outputsStorageRef` → `try { JSON.parse((await this.storage.downloadFile(row.outputsStorageRef)).toString('utf8')) } catch { fall back to row.outputs }`; else `row.outputs`.
    5. `const extracted = extractAssets({ componentId: event.componentId, nodeRef: event.nodeRef, runId: event.runId, outputs });`
    6. Map to `NewAssetRecord[]` (organizationId = run.organizationId, scopeId = run.scopeId, firstSeenRunId = lastSeenRunId = event.runId) and `await this.repository.upsertMany(records)`.
  - `listAssets(auth, scopeId, opts)` for the controller: `requireOrganizationId(auth)`, validate the scope belongs to the org (via ScopesService/repository findById), `repository.listByScope`.
    Inject: `AssetInventoryRepository`, `NodeIORepository`, `WorkflowRunRepository`, `StorageService`, `ScopesRepository|ScopesService`.

- [ ] **Step 3: Controller + module** — `assets.controller.ts`: `@Controller('scopes')` with `@Get(':scopeId/assets')` (any authenticated role) → `assetsService.listAssets(auth, scopeId, { assetType, limit })`, `ParseUUIDPipe` on scopeId, `AssetResponse` DTO (mirror the field contract). `assets.module.ts` imports `DatabaseModule` + whatever modules provide `NodeIORepository`/`WorkflowRunRepository`/`StorageService`/`ScopesService` (import those modules or re-provide). Register `AssetsModule` in `app.module.ts` coreModules. NOTE: emitting from `node-io.repository.ts` needs `EventEmitter2` injectable there — confirm the NodeIO module imports work; if injecting into the repository is awkward, emit from `NodeIOIngestService.persistEvent` right after `recordCompletion` instead (it can inject EventEmitter2 more naturally).

- [ ] **Step 4: Integration test** — `assets.service.spec.ts`: mock `nodeIORepository.findByRunAndNode` (returns a subfinder row with `outputs: { subdomains: [...] }`, org set), `workflowRunRepository.findByRunId` (returns `{ organizationId, scopeId }`), `storage`, and assert `repository.upsertMany` is called with the extracted subdomain assets (org/scopeId/runId set). Also: a run with null scopeId → `upsertMany` NOT called; a non-recon component → returns early; a spilled row → `storage.downloadFile` called and its parsed outputs used. Run `cd backend && bun test src/assets/`.

- [ ] **Step 5: openapi + boot** — `cd backend && bun run generate:openapi` (adds `/scopes/{scopeId}/assets`); confirm health 200 after reload. Commit both the code and openapi.
- [ ] **Step 6: Commit** — `git add backend/src/assets backend/src/node-io backend/src/app.module.ts openapi.json && git commit -m "feat(assets): auto-ingest recon assets into per-target inventory"`

---

### Task 4: Frontend Assets tab

**Files:** Create `frontend/src/services/api/assets.ts`; modify `services/api/index.ts`, `lib/queryKeys.ts`, `hooks/queries/useScopeQueries.ts` (add `useTargetAssets`), `pages/target-detail/targetDetailTypes.ts`, `pages/target-detail/useTargetDetail.ts`, `pages/TargetDetailPage.tsx`, `routes.tsx`. Test: `pages/__tests__/TargetDetailPage.assets.test.tsx` (or extend the existing detail test).

- [ ] **Step 1: api + query** — `assets.ts`: `export const assetsApi = { listByScope: (scopeId: string) => api.get<Asset[]>(`/scopes/${scopeId}/assets`) };` (raw helper, mirror `scopes.ts` — import raw `httpGet` from `./client` to avoid the aggregator cycle). Register `assets: assetsApi` in `services/api/index.ts`. Add `targets.assets(id)` to `queryKeys.ts`. Add `useTargetAssets(scopeId)` to `useScopeQueries.ts` mirroring `useScopeRuns` (queryKey `queryKeys.targets.assets(scopeId)`, `enabled: !!scopeId`).

- [ ] **Step 2: Tab** — add `'assets'` to `TARGET_DETAIL_TABS`; in `useTargetDetail.ts` add the `.endsWith('/assets')` branch + `useTargetAssets(scopeId)` returning `assets`/`isLoadingAssets`; in `TargetDetailPage.tsx` add `<TabsTrigger value="assets">Assets</TabsTrigger>` + a `<TabsContent value="assets">` with a table (Asset value, Type badge, First seen, Last seen, Source) using `formatTimeAgo`/`formatStartTime`, a loading skeleton, and an `EmptyState` "No assets yet" / "Discovered assets from recon runs against this target will appear here." In `routes.tsx` add `<Route path="/targets/:id/assets" ...>` (same page).

- [ ] **Step 3: Test** — mock `useTargetAssets`; (a) Assets tab shows an asset row (value + type); (b) empty → "No assets yet". Run `cd frontend && bun test src/pages/__tests__/TargetDetailPage*.test.tsx`.

- [ ] **Step 4: Typecheck/lint + commit** — `cd frontend && bunx tsc --noEmit`; eslint touched files. `git add <touched> && git commit -m "feat(targets): add Assets tab to target detail"`

---

## Browser Verification (gate before Phase 5) — SAFE, no external scanning

Do NOT run a real recon workflow against a live host. Verify via seeding + the real query/UI:

1. Seed 2-3 `asset_inventory` rows via psql for the Acme scope (assetType subdomain/http-probe/open-port, distinct values, firstSeen/lastSeen set, a lastSeenRunId).
2. Open the Acme target detail → **Assets** tab (`/targets/:id/assets`); confirm the seeded assets render with value, type badge, first/last seen.
3. Empty scope → "No assets yet".
4. (Extractor/ingestion path) verified by backend tests (Task 2 + Task 3), not a live run.
5. No console errors.

Optionally, to exercise the REAL ingestion path safely: directly emit the event / call `AssetInventoryService.onNodeIoCompleted` semantics is covered by the Task 3 integration test; a live end-to-end run is intentionally skipped to avoid scanning.

## Self-Review

- Coverage: schema+types (T1), extractor+key+tests (T2), ingestion listener+read module+tests (T3), frontend Assets tab (T4), safe browser gate. ✓
- Placeholder scan: the two "confirm import path" notes (`@sentris/shared` normalizeFindings specifier in T2 S3; EventEmitter2 injection site in T3 S3) are explicit verify-then-adapt steps, not fabrications.
- Type consistency: `AssetType` union identical across schema enum (T1), extractor (T2), frontend type (T1 S2), and the response DTO (T3). Upsert conflict target matches the unique index exactly.
