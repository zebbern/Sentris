# Local Usability — Phase 4: Asset Inventory Auto-Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Automatically extract discovered assets (subdomains, hosts, IPs, open ports, HTTP probes, DNS records, crawled URLs) from a recon run's node outputs and upsert them into a per-Target `asset_inventory`, tracked over time (first/last seen), keyed by the `scopeId` the run was launched against (Phase 3's stamp). Surface them on a new filterable **Assets** tab on the existing Target detail page.

**Architecture:** Backend post-run ingestion at the `node_io` chokepoint, decoupled via `EventEmitter2` (mirrors `finding.triage.changed`). After the ingest consumer persists a completion (`NodeIOIngestService.persistEvent` → `NodeIORepository.recordCompletion`), it emits `asset.nodeio.completed`. An `AssetInventoryService` `@OnEvent` listener (mirroring `ticketing-listener`'s error-swallowing) recovers `organizationId` from the `node_io` row and `scopeId` from `workflow_runs` (via `WorkflowRunRepository.findByRunId`), **skips runs with no `scopeId` (explicit-only feed)** and **guards null org**, fetches spilled outputs from object storage via `StorageService.downloadFile`, runs a **pure extractor** (driven off `@sentris/shared`'s `normalizeAllFindings` + `NORMALIZER_MAP`, with an explicit `finding.type → asset_type` allowlist and per-type `assetValue` derivation) over asset-bearing recon components, and upserts into `asset_inventory` on the dedup key — bumping `lastSeenAt`/`lastSeenRunId` only, never `firstSeen*`. A read module exposes `GET /scopes/:scopeId/assets` (filterable by type). Extractor/ingestion failures never break the run-record write path. Frontend adds a `useScopeAssets(id)` hook + Assets tab.

**Tech Stack:** NestJS + Drizzle (drizzle-kit push) + `@nestjs/event-emitter`, MinIO via `StorageService`, `@sentris/shared` `normalizeAllFindings`, `@sentris/component-sdk` spill markers, React + TanStack Query + shadcn/ui, `bun:test`.

## Starting State (read before Task 1)

Base this branch on `main` (Phases 0–3 merged at `36d0fc7d`). On `main`:

- `scopes` table + `ScopesModule` (exports `ScopesService`) + frontend `api.scopes`/`useScope`/`useScopeRuns` exist (P1/P3).
- `workflow_runs.scopeId` (nullable uuid) + `WorkflowRunRepository.findByRunId(runId, { organizationId? })` returning `WorkflowRunRecord | undefined` (with `scopeId` and `organizationId` fields) exist (P3).
- `TargetDetailPage` has route-driven Tabs (**Overview**, **Run History**) via `pages/target-detail/{useTargetDetail.ts,targetDetailTypes.ts,index.ts}`; routes `/targets/:id` and `/targets/:id/runs` exist (P3).
- `EventEmitterModule.forRoot()` is registered globally in `app.module.ts`; `FindingTriageService` (emit pattern) and `TicketingListenerService` (`@OnEvent(..., { async: true })`) are the exact reference patterns.
- `NodeIORepository.recordCompletion` (the node-output chokepoint) and `NodeIOIngestService.persistEvent` (the Kafka consumer that calls it) exist. **Neither injects `EventEmitter2` today — the emit wiring is added in Task 5.**
- `StorageService.downloadFile(storageKey): Promise<Buffer>` exists; `NodeIOService.toDetail` is the reference for the spill-fetch pattern.
- `@sentris/shared` exports `normalizeAllFindings` + `NORMALIZER_MAP` (backend already imports `@sentris/shared` elsewhere).

> **Note on prior work:** a superseded draft `docs/superpowers/plans/2026-07-24-local-usability-phase-4-asset-inventory.md` (and any partial branch) may exist. This document replaces it; plan against `main` and re-derive each artifact via TDD below. If the draft is present on the branch point, `git rm` it in the plan-doc commit.

**Branch + plan-doc commit (before Task 1):** create `feat/phase-4-asset-inventory-autofeed` from `main`. First commit on the branch is this plan doc (removing the superseded draft in the same commit if it is present):
`git checkout -b feat/phase-4-asset-inventory-autofeed && git add docs/superpowers/plans/2026-07-24-local-usability-phase-4-asset-inventory-autofeed.md && git rm --ignore-unmatch docs/superpowers/plans/2026-07-24-local-usability-phase-4-asset-inventory.md && git commit -m "docs: add Phase 4 asset-inventory autofeed plan"`

## Global Constraints

- **Migrations are push/diff based:** `cd backend && bun run migration:push`. Do NOT hand-author `backend/drizzle/*.sql`. This is the **only** stack-touching command permitted; if run, **say so explicitly in the task notes**. Do NOT start Docker/PM2/dev servers — the Browser Verification gate is executed by the user.
- **Org-scoping style:** `asset_inventory` follows the `agent-skills`/`finding-triage` `.notNull()` convention (org `varchar(191).notNull()`, uuid pk `defaultRandom`, unique index, `withTimezone` timestamps, `$inferSelect`/`$inferInsert`), NOT the nullable `secrets.ts` style. FK `scopeId → scopes.id` with `onDelete: 'cascade'` (mirrors finding-triage's externally-keyed augmentation) — cascade is required or scope delete fails.
- **Resilience:** the event emit is wrapped in try/catch at the chokepoint (like `finding-triage.service`); the `@OnEvent` handler wraps its whole body in try/catch and logs (like `ticketing-listener`) — it must NEVER throw into the node-io write path.
- **Explicit-only feed:** attribute assets to a scope ONLY when the run has a non-null `scopeId`. Guard null `organizationId` too (both `node_io.organizationId` and `workflow_runs.organizationId` are nullable).
- **Completion event carries no org/scope ids** — read `organizationId`/`outputs`/spill fields from the persisted `node_io` row (`NodeIORepository.findByRunAndNode(runId, nodeRef)`), and `scopeId`/`organizationId` from `workflow_runs` (`WorkflowRunRepository.findByRunId(runId)`).
- **Recon-only:** define `RECON_COMPONENT_IDS = new Set(['sentris.subfinder.run','sentris.httpx.scan','sentris.naabu.scan','sentris.dnsx.run','sentris.katana.run','sentris.theharvester.run'])`. Fast-skip a non-recon completion (by `event.componentId` when present) BEFORE any DB read; re-check the row's authoritative `componentId` before touching outputs/spill.
- **Spill:** if `row.outputsSpilled && row.outputsStorageRef` (or `row.outputs` is a spill marker per `isSpilledDataMarker` from `@sentris/component-sdk`), fetch full outputs via `StorageService.downloadFile(ref)` + `JSON.parse(buf.toString('utf8'))`, inside try/catch (mirror `NodeIOService.toDetail`); else use the row's `outputs` jsonb. Full capture, not preview.
- **Extractor allowlist (accuracy decision):** `normalizeAllFindings` emits a human `finding` string + a `type` that includes NON-asset kinds (`vulnerability`, `code-finding`, `email`, `container-vuln`, …). The extractor maps ONLY asset-bearing `type`s and derives `assetValue` per type (no single generic key — `open-port` needs `host:port`, which a naive `metadata.host` lookup would drop). The `host` and `url` enum members are retained in the schema for forward-compat but are **not produced by any normalizer today**, so the MVP extractor intentionally does not emit them.
- **Upsert first/last-seen:** on conflict `(organizationId, scopeId, assetType, assetValue)`, `set` bumps `lastSeenAt`/`lastSeenRunId`/`sourceComponentId`/`metadata`/`updatedAt` only — NEVER `firstSeenAt`/`firstSeenRunId`.
- No `any` in production. Match existing lint/format conventions. Commit after each task. No pushes to any remote; no merges.

## File Structure

- **Task 1 (backend + fe types):** create `backend/src/database/schema/assets.ts`; modify `backend/src/database/schema/index.ts`; add `AssetType`/`Asset` to `frontend/src/types/scopes.ts`.
- **Task 2 (pure extractor):** create `backend/src/assets/asset-extractor.ts`, `backend/src/assets/__tests__/asset-extractor.spec.ts`.
- **Task 3 (repository):** create `backend/src/assets/assets.repository.ts`, `backend/src/assets/__tests__/assets.repository.spec.ts`.
- **Task 4 (read module):** create `backend/src/assets/assets.service.ts`, `backend/src/assets/assets.controller.ts`, `backend/src/assets/assets.module.ts`, `backend/src/assets/dto/assets.dto.ts`, `backend/src/assets/__tests__/assets.service.spec.ts`; modify `backend/src/app.module.ts`, `openapi.json`.
- **Task 5 (ingestion):** modify `backend/src/node-io/node-io-ingest.service.ts` (emit); add `AssetInventoryService` listener (in `backend/src/assets/asset-inventory.service.ts`) + register in `assets.module.ts`; create `backend/src/assets/__tests__/asset-inventory.service.spec.ts`.
- **Task 6 (frontend tab):** create `frontend/src/services/api/assets.ts`; modify `frontend/src/services/api/index.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/hooks/queries/useScopeQueries.ts`, `frontend/src/pages/target-detail/targetDetailTypes.ts`, `frontend/src/pages/target-detail/useTargetDetail.ts`, `frontend/src/pages/TargetDetailPage.tsx`, `frontend/src/routes.tsx`; test `frontend/src/pages/__tests__/TargetDetailPage.assets.test.tsx`.
- **Task 7 (e2e):** create `e2e-tests/core/asset-inventory.test.ts` (+ helpers as needed in `e2e-tests/helpers/e2e-harness.ts`).

---

### Task 1: `asset_inventory` schema + migration + Asset types

**Files:** create `backend/src/database/schema/assets.ts`; modify `backend/src/database/schema/index.ts`; modify `frontend/src/types/scopes.ts`.

**Interfaces produced:** `assetTypeEnum` pgEnum; `assetInventory` table; `AssetRecord`/`NewAssetRecord`; frontend `AssetType`/`Asset`.

- [ ] **Step 1: pgEnum + table** — create `backend/src/database/schema/assets.ts`:

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

- [ ] **Step 2: Re-export** — append `export * from './assets';` to `backend/src/database/schema/index.ts` (match the existing per-schema export style).

- [ ] **Step 3: Frontend Asset type** — in `frontend/src/types/scopes.ts` append:

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

- [ ] **Step 4: Migration** — `cd backend && bun run migration:push`. Confirm the diff is **additive only** (creates the `asset_type` enum + `asset_inventory` table + its 4 indexes; no drops/truncates — abort and investigate if drizzle-kit proposes anything destructive). **Report explicitly in the task notes that the migration was run.**
- [ ] **Step 5: Typecheck** — `cd backend && bun run typecheck`; `cd frontend && bunx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add backend/src/database/schema/assets.ts backend/src/database/schema/index.ts frontend/src/types/scopes.ts && git commit -m "feat(assets): add asset_inventory schema and Asset type"`

---

### Task 2: Pure recon asset extractor + table-driven tests

**Files:** create `backend/src/assets/asset-extractor.ts`, `backend/src/assets/__tests__/asset-extractor.spec.ts`.

**Interfaces produced:** `RECON_COMPONENT_IDS: ReadonlySet<string>`; `ExtractedAsset = { assetType: AssetType; assetValue: string; sourceComponentId: string; metadata: Record<string, unknown> }`; `extractAssets(input: { componentId: string; nodeRef: string; runId: string; outputs: Record<string, unknown> | null }): ExtractedAsset[]`.

- [ ] **Step 1: Failing test** — create `backend/src/assets/__tests__/asset-extractor.spec.ts` with table-driven cases over real `normalizeAllFindings` output shapes:

```ts
import { describe, it, expect } from 'bun:test';
import { extractAssets } from '../asset-extractor';

describe('extractAssets', () => {
  it('extracts subdomains from subfinder output (value = the subdomain)', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n1',
      runId: 'r1',
      outputs: { subdomains: ['a.example.com', 'b.example.com'] },
    });
    expect(out.map((a) => a.assetType)).toEqual(['subdomain', 'subdomain']);
    expect(out.map((a) => a.assetValue).sort()).toEqual(['a.example.com', 'b.example.com']);
    expect(out[0]?.sourceComponentId).toBe('sentris.subfinder.run');
  });

  it('extracts http-probe assets with url from metadata (not the human string)', () => {
    const out = extractAssets({
      componentId: 'sentris.httpx.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { responses: [{ url: 'https://x.example.com', statusCode: 200 }] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ assetType: 'http-probe', assetValue: 'https://x.example.com' });
    expect(out[0]?.metadata).toMatchObject({ statusCode: 200 });
  });

  it('extracts open-port assets from naabu (value = host:port)', () => {
    const out = extractAssets({
      componentId: 'sentris.naabu.scan',
      nodeRef: 'n',
      runId: 'r',
      outputs: { findings: [{ host: 'h.example.com', port: 8080, protocol: 'tcp' }] },
    });
    expect(out[0]?.assetType).toBe('open-port');
    expect(out[0]?.assetValue).toBe('h.example.com:8080');
    expect(out[0]?.metadata).toMatchObject({ host: 'h.example.com', port: 8080 });
  });

  it('extracts dns-record assets from dnsx (value = host)', () => {
    const out = extractAssets({
      componentId: 'sentris.dnsx.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { dnsRecords: [{ host: 'mail.example.com', type: 'A' }] },
    });
    expect(out[0]).toMatchObject({ assetType: 'dns-record', assetValue: 'mail.example.com' });
  });

  it('extracts crawled-url assets from katana', () => {
    const out = extractAssets({
      componentId: 'sentris.katana.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { endpoints: ['https://x.example.com/login'] },
    });
    expect(out[0]).toMatchObject({
      assetType: 'crawled-url',
      assetValue: 'https://x.example.com/login',
    });
  });

  it('extracts subdomains + ip-address from theHarvester but DROPS emails', () => {
    const out = extractAssets({
      componentId: 'sentris.theharvester.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: {
        emails: ['a@example.com'],
        subdomains: ['dev.example.com'],
        ips: ['1.2.3.4'],
      },
    });
    const types = out.map((a) => a.assetType).sort();
    expect(types).toEqual(['ip-address', 'subdomain']);
    expect(out.find((a) => a.assetType === 'ip-address')?.assetValue).toBe('1.2.3.4');
  });

  it('returns [] for a non-recon component (nuclei)', () => {
    expect(
      extractAssets({
        componentId: 'sentris.nuclei.scan',
        nodeRef: 'n',
        runId: 'r',
        outputs: { findings: [{ name: 'x', severity: 'high' }] },
      }),
    ).toEqual([]);
  });

  it('dedupes identical assets within a single batch', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['dup.example.com', 'dup.example.com'] },
    });
    expect(out).toHaveLength(1);
  });

  it('skips empty/whitespace asset values', () => {
    const out = extractAssets({
      componentId: 'sentris.subfinder.run',
      nodeRef: 'n',
      runId: 'r',
      outputs: { subdomains: ['', '  '] },
    });
    expect(out).toEqual([]);
  });

  it('returns [] when outputs is null', () => {
    expect(
      extractAssets({
        componentId: 'sentris.subfinder.run',
        nodeRef: 'n',
        runId: 'r',
        outputs: null,
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — fails** (module missing). `cd backend && bun test src/assets/__tests__/asset-extractor.spec.ts`

- [ ] **Step 3: Implement `asset-extractor.ts`**:

```ts
import { normalizeAllFindings, type Finding } from '@sentris/shared';
import type { AssetType } from '../database/schema';

/** Recon components whose outputs carry inventory assets. */
export const RECON_COMPONENT_IDS: ReadonlySet<string> = new Set([
  'sentris.subfinder.run',
  'sentris.httpx.scan',
  'sentris.naabu.scan',
  'sentris.dnsx.run',
  'sentris.katana.run',
  'sentris.theharvester.run',
]);

/** normalizeFindings `type` → asset_type. Only asset-bearing kinds map; the rest are dropped. */
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

function str(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/** Per-type assetValue: prefer the structured metadata key over the human `finding` string. */
function deriveAssetValue(assetType: AssetType, finding: Finding): string {
  const md = (finding.metadata ?? {}) as Record<string, unknown>;
  switch (assetType) {
    case 'http-probe':
      return str(md.url) || finding.finding;
    case 'open-port': {
      const host = str(md.host);
      const port = str(md.port);
      return host && port ? `${host}:${port}` : finding.finding;
    }
    case 'dns-record':
      return str(md.host ?? md.name) || finding.finding;
    default:
      // subdomain, ip-address, crawled-url — the `finding` string IS the value.
      return finding.finding;
  }
}

/**
 * Pure extractor: normalize a single recon node's outputs into deduped assets.
 * Non-recon components yield `[]`. Failures inside normalizeAllFindings are swallowed there.
 */
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
    const assetValue = deriveAssetValue(assetType, f).trim();
    if (!assetValue) continue;
    const key = `${assetType}�${assetValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      assetType,
      assetValue,
      sourceComponentId: input.componentId,
      metadata: (f.metadata ?? {}) as Record<string, unknown>,
    });
  }
  return out;
}
```

> `AssetType` is imported as the `assetTypeEnum` union — re-export the union from `backend/src/database/schema/assets.ts` if `import type { AssetType }` does not already resolve. Add `export type AssetType = (typeof assetTypeEnum.enumValues)[number];` to `assets.ts` in Task 1 Step 1 if needed (adjust that step accordingly and re-commit under Task 1, or add it here and note it). Confirm `@sentris/shared` re-exports `normalizeAllFindings` + `Finding` (it does, via `findings/index`).

- [ ] **Step 4: Run — passes.** `cd backend && bun test src/assets/__tests__/asset-extractor.spec.ts`
- [ ] **Step 5: Typecheck + lint** — `cd backend && bun run typecheck`; `cd backend && bunx eslint src/assets/asset-extractor.ts src/assets/__tests__/asset-extractor.spec.ts`.
- [ ] **Step 6: Commit** — `git add backend/src/assets/asset-extractor.ts backend/src/assets/__tests__/asset-extractor.spec.ts && git commit -m "feat(assets): add pure recon asset extractor"`

---

### Task 3: Asset inventory repository + spec

**Files:** create `backend/src/assets/assets.repository.ts`, `backend/src/assets/__tests__/assets.repository.spec.ts`.

**Interfaces produced:** `AssetInventoryRepository` with `upsertMany(records: NewAssetRecord[]): Promise<void>` (per-record `onConflictDoUpdate` on the dedup key, bumping last-seen only) and `listByScope(scopeId, organizationId, opts?: { assetType?: AssetType; limit?: number }): Promise<AssetRecord[]>` (org+scope ANDed, optional type filter, `desc(lastSeenAt)`).

- [ ] **Step 1: Failing test** — create `backend/src/assets/__tests__/assets.repository.spec.ts` mirroring the drizzle-chain capture style of `backend/src/workflows/repository/__tests__/workflow-run.repository.spec.ts`. Capture what `upsertMany` builds per record:

```ts
import { describe, it, expect } from 'bun:test';
import { AssetInventoryRepository } from '../assets.repository';
import type { NewAssetRecord } from '../../database/schema';

function makeDb() {
  const calls: { values: Record<string, unknown>; set: Record<string, unknown> }[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: (opts: { target: unknown; set: Record<string, unknown> }) => {
          calls.push({ values: v, set: opts.set });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, calls };
}

const base: NewAssetRecord = {
  organizationId: 'org-1',
  scopeId: 'scope-1',
  assetType: 'subdomain',
  assetValue: 'a.example.com',
  firstSeenRunId: 'sentris-run-1',
  lastSeenRunId: 'sentris-run-1',
  sourceComponentId: 'sentris.subfinder.run',
  metadata: {},
};

describe('AssetInventoryRepository.upsertMany', () => {
  it('inserts each record and bumps ONLY last-seen fields on conflict', async () => {
    const { db, calls } = makeDb();
    const repo = new AssetInventoryRepository(db as never);
    await repo.upsertMany([base, { ...base, assetValue: 'b.example.com' }]);
    expect(calls).toHaveLength(2);
    // insert carries firstSeen* (run id); conflict `set` must NOT touch firstSeen*.
    expect(calls[0]?.values.firstSeenRunId).toBe('sentris-run-1');
    expect('firstSeenAt' in (calls[0]?.set ?? {})).toBe(false);
    expect('firstSeenRunId' in (calls[0]?.set ?? {})).toBe(false);
    expect(calls[0]?.set.lastSeenRunId).toBe('sentris-run-1');
    expect('lastSeenAt' in (calls[0]?.set ?? {})).toBe(true);
  });

  it('no-ops on an empty batch', async () => {
    const { db, calls } = makeDb();
    const repo = new AssetInventoryRepository(db as never);
    await repo.upsertMany([]);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — fails** (module missing). `cd backend && bun test src/assets/__tests__/assets.repository.spec.ts`

- [ ] **Step 3: Implement `assets.repository.ts`** (mirror `agent-skills.repository` injection + `and`/`eq`/`desc` query style):

```ts
import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, desc } from 'drizzle-orm';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  assetInventory,
  type AssetRecord,
  type NewAssetRecord,
  type AssetType,
} from '../database/schema';

@Injectable()
export class AssetInventoryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
  ) {}

  async upsertMany(records: NewAssetRecord[]): Promise<void> {
    if (records.length === 0) return;
    const now = new Date();
    for (const record of records) {
      await this.db
        .insert(assetInventory)
        .values(record)
        .onConflictDoUpdate({
          target: [
            assetInventory.organizationId,
            assetInventory.scopeId,
            assetInventory.assetType,
            assetInventory.assetValue,
          ],
          set: {
            lastSeenAt: now,
            lastSeenRunId: record.lastSeenRunId ?? null,
            sourceComponentId: record.sourceComponentId ?? null,
            metadata: record.metadata ?? {},
            updatedAt: now,
          },
        });
    }
  }

  async listByScope(
    scopeId: string,
    organizationId: string,
    opts: { assetType?: AssetType; limit?: number } = {},
  ): Promise<AssetRecord[]> {
    const conditions = [
      eq(assetInventory.organizationId, organizationId),
      eq(assetInventory.scopeId, scopeId),
    ];
    if (opts.assetType) {
      conditions.push(eq(assetInventory.assetType, opts.assetType));
    }
    const query = this.db
      .select()
      .from(assetInventory)
      .where(and(...conditions))
      .orderBy(desc(assetInventory.lastSeenAt));
    return opts.limit ? query.limit(opts.limit) : query;
  }
}
```

- [ ] **Step 4: Run — passes.** `cd backend && bun test src/assets/__tests__/assets.repository.spec.ts`
- [ ] **Step 5: Typecheck + lint** — `cd backend && bun run typecheck`; `cd backend && bunx eslint src/assets/assets.repository.ts src/assets/__tests__/assets.repository.spec.ts`.
- [ ] **Step 6: Commit** — `git add backend/src/assets/assets.repository.ts backend/src/assets/__tests__/assets.repository.spec.ts && git commit -m "feat(assets): add asset inventory repository"`

---

### Task 4: Assets read module (`GET /scopes/:scopeId/assets`) + service spec + OpenAPI

**Files:** create `backend/src/assets/assets.service.ts`, `backend/src/assets/assets.controller.ts`, `backend/src/assets/assets.module.ts`, `backend/src/assets/dto/assets.dto.ts`, `backend/src/assets/__tests__/assets.service.spec.ts`; modify `backend/src/app.module.ts`, `openapi.json`.

**Interfaces produced:** `AssetsService.listAssets(auth, scopeId, opts): Promise<AssetResponse[]>` (validates scope belongs to org via `ScopesService.getScope`, then `repository.listByScope`); `GET /scopes/:scopeId/assets?type=&limit=`.

> This task delivers the **read** side and registers the module. The `upsertMany` write side (Task 3) and the ingestion listener (Task 5) live in the same module; `AssetInventoryService` (the listener) is added in Task 5. Keep `AssetsService` (read) and `AssetInventoryService` (ingest) as **two providers** so the read path has no `NodeIORepository`/`Storage` dependency.

- [ ] **Step 1: DTO** — create `backend/src/assets/dto/assets.dto.ts` (mirror `scopes/dto/scopes.dto.ts` `createZodDto` style):

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssetResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  scopeId: z.string().uuid(),
  assetType: z.enum([
    'subdomain',
    'host',
    'ip-address',
    'open-port',
    'http-probe',
    'dns-record',
    'crawled-url',
    'url',
  ]),
  assetValue: z.string(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  firstSeenRunId: z.string().nullable(),
  lastSeenRunId: z.string().nullable(),
  sourceComponentId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class AssetResponse extends createZodDto(AssetResponseSchema) {}
```

- [ ] **Step 2: Failing test** — create `backend/src/assets/__tests__/assets.service.spec.ts` (mirror `scopes.service.spec.ts`: `AuthContext` with `DEFAULT_ORGANIZATION_ID`, `vi.fn` mocks). Cases:
  - `listAssets(auth, 'scope-1', {})` validates the scope (`scopesService.getScope` called with `(auth, 'scope-1')`) then returns mapped rows from `repository.listByScope('scope-1', DEFAULT_ORGANIZATION_ID, {})`; `createdAt`/`firstSeenAt` are ISO strings.
  - a `type` filter is forwarded: `listAssets(auth, 'scope-1', { assetType: 'subdomain' })` → `repository.listByScope('scope-1', DEFAULT_ORGANIZATION_ID, { assetType: 'subdomain', limit: undefined })`.
  - `getScope` throwing `NotFoundException` propagates (scope not in org → 404).
  - `auth = null` → `ForbiddenException` (via `requireOrganizationId`).

- [ ] **Step 3: Run — fails.** `cd backend && bun test src/assets/__tests__/assets.service.spec.ts`

- [ ] **Step 4: Implement service + controller + module**:
  - `assets.service.ts` — inject `AssetInventoryRepository` + `ScopesService`; `listAssets(auth, scopeId, opts)`: `const organizationId = requireOrganizationId(auth); await this.scopesService.getScope(auth, scopeId); // 404s if not in org` then `const rows = await this.repository.listByScope(scopeId, organizationId, opts);` and `return rows.map(this.mapToResponse)`. `mapToResponse` mirrors `scopes.service` (`.toISOString()` on all timestamps; `metadata: record.metadata ?? {}`).
  - `assets.controller.ts` — `@ApiTags('assets')` `@Controller('scopes')` with a single `@Get(':scopeId/assets')` (no `@Roles` — any authenticated, mirrors `ScopesController.getScope`): `@Param('scopeId', new ParseUUIDPipe()) scopeId`, `@Query('type') type?: string`, `@Query('limit') limit?: string`, `@CurrentAuth() auth`. Validate `type` against the enum (ignore unknown values → treat as no filter) and `limit` via `Number.parseInt` guarded to a small max (e.g. 1000). `@ApiOkResponse({ type: [AssetResponse] })`.
  - `assets.module.ts` — `imports: [DatabaseModule, ScopesModule]`, `controllers: [AssetsController]`, `providers: [AssetsService, AssetInventoryRepository]`, `exports: [AssetInventoryRepository]`. (Task 5 adds `AssetInventoryService` to providers and the `NodeIOModule`/`WorkflowsModule`/`StorageModule` imports.)
  - Register `AssetsModule` in `backend/src/app.module.ts` `coreModules` (next to `ScopesModule`).

- [ ] **Step 5: Run — passes.** `cd backend && bun test src/assets/` (extractor + repository + service).
- [ ] **Step 6: OpenAPI + typecheck + lint** — `cd backend && bun run generate:openapi` (adds `GET /api/v1/scopes/{scopeId}/assets`); confirm via `git diff openapi.json`. Then `cd backend && bun run typecheck` and `cd backend && bunx eslint src/assets src/app.module.ts`.
- [ ] **Step 7: Commit** — `git add backend/src/assets backend/src/app.module.ts openapi.json && git commit -m "feat(assets): add per-target assets read endpoint"`

---

### Task 5: Ingestion — emit `asset.nodeio.completed` + `AssetInventoryService` listener + spec

**Files:** modify `backend/src/node-io/node-io-ingest.service.ts` (emit); create `backend/src/assets/asset-inventory.service.ts` (listener), `backend/src/assets/__tests__/asset-inventory.service.spec.ts`; modify `backend/src/assets/assets.module.ts` (wire deps + register provider).

**Interfaces produced:** `AssetNodeIoCompletedEvent = { runId: string; nodeRef: string; componentId?: string }`; `AssetInventoryService.onNodeIoCompleted(event)` (`@OnEvent('asset.nodeio.completed', { async: true })`).

- [ ] **Step 1: Failing test** — create `backend/src/assets/__tests__/asset-inventory.service.spec.ts`. Mock `AssetInventoryRepository` (`upsertMany`), `NodeIORepository` (`findByRunAndNode`), `WorkflowRunRepository` (`findByRunId`), `StorageService` (`downloadFile`) with `vi.fn`. Cases:
  - **Happy path (in-line outputs):** `findByRunAndNode` → subfinder row `{ componentId: 'sentris.subfinder.run', organizationId: 'org-1', outputs: { subdomains: ['a.example.com'] }, outputsSpilled: false, outputsStorageRef: null }`; `findByRunId` → `{ organizationId: 'org-1', scopeId: 'scope-1' }`. After `onNodeIoCompleted({ runId: 'sentris-run-1', nodeRef: 'n1', componentId: 'sentris.subfinder.run' })`, `upsertMany` called once with a record `{ organizationId: 'org-1', scopeId: 'scope-1', assetType: 'subdomain', assetValue: 'a.example.com', firstSeenRunId: 'sentris-run-1', lastSeenRunId: 'sentris-run-1', sourceComponentId: 'sentris.subfinder.run' }`.
  - **Null scopeId → skip:** `findByRunId` → `{ organizationId: 'org-1', scopeId: null }` ⇒ `upsertMany` NOT called.
  - **Null org → skip:** `findByRunId` → `{ organizationId: null, scopeId: 'scope-1' }` ⇒ `upsertMany` NOT called.
  - **Non-recon component → early return:** event `componentId: 'sentris.nuclei.scan'` ⇒ neither `findByRunAndNode` nor `upsertMany` called.
  - **Spilled outputs:** row `{ outputsSpilled: true, outputsStorageRef: 'ref-1', outputs: <spill marker> }`; `storage.downloadFile('ref-1')` resolves `Buffer.from(JSON.stringify({ subdomains: ['spilled.example.com'] }))` ⇒ `downloadFile` called and `upsertMany` gets `assetValue: 'spilled.example.com'`.
  - **Never throws:** if `findByRunAndNode` rejects, `onNodeIoCompleted` resolves without throwing (the swallow-all guard) and `upsertMany` is not called.

- [ ] **Step 2: Run — fails** (module missing). `cd backend && bun test src/assets/__tests__/asset-inventory.service.spec.ts`

- [ ] **Step 3: Implement `asset-inventory.service.ts`**:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { isSpilledDataMarker } from '@sentris/component-sdk';

import { NodeIORepository } from '../node-io/node-io.repository';
import { WorkflowRunRepository } from '../workflows/repository/workflow-run.repository';
import { StorageService } from '../storage/storage.service';
import type { NewAssetRecord } from '../database/schema';
import { AssetInventoryRepository } from './assets.repository';
import { RECON_COMPONENT_IDS, extractAssets } from './asset-extractor';

export interface AssetNodeIoCompletedEvent {
  runId: string;
  nodeRef: string;
  componentId?: string;
}

@Injectable()
export class AssetInventoryService {
  private readonly logger = new Logger(AssetInventoryService.name);

  constructor(
    private readonly repository: AssetInventoryRepository,
    private readonly nodeIORepository: NodeIORepository,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly storage: StorageService,
  ) {}

  @OnEvent('asset.nodeio.completed', { async: true })
  async onNodeIoCompleted(event: AssetNodeIoCompletedEvent): Promise<void> {
    try {
      // Fast-skip non-recon completions before any DB read.
      if (event.componentId && !RECON_COMPONENT_IDS.has(event.componentId)) return;

      const row = await this.nodeIORepository.findByRunAndNode(event.runId, event.nodeRef);
      if (!row) return;
      const componentId = row.componentId;
      if (!RECON_COMPONENT_IDS.has(componentId)) return;

      const run = await this.workflowRunRepository.findByRunId(event.runId);
      // Explicit-only feed + null-org guard.
      if (!run?.organizationId || !run.scopeId) return;

      const outputs = await this.resolveOutputs(row);
      const extracted = extractAssets({
        componentId,
        nodeRef: event.nodeRef,
        runId: event.runId,
        outputs,
      });
      if (extracted.length === 0) return;

      const records: NewAssetRecord[] = extracted.map((a) => ({
        organizationId: run.organizationId!,
        scopeId: run.scopeId!,
        assetType: a.assetType,
        assetValue: a.assetValue,
        firstSeenRunId: event.runId,
        lastSeenRunId: event.runId,
        sourceComponentId: a.sourceComponentId,
        metadata: a.metadata,
      }));
      await this.repository.upsertMany(records);
    } catch (err) {
      // Never propagate — ingestion must not break the node-io write path.
      this.logger.error(
        `Failed to ingest assets for run=${event.runId} node=${event.nodeRef}: ${err}`,
      );
    }
  }

  /** Return the node's full outputs, fetching from object storage when spilled. */
  private async resolveOutputs(row: {
    outputs: Record<string, unknown> | null;
    outputsSpilled: boolean;
    outputsStorageRef: string | null;
  }): Promise<Record<string, unknown> | null> {
    const marker = isSpilledDataMarker(row.outputs);
    const ref =
      row.outputsStorageRef ?? (marker ? (row.outputs as { storageRef: string }).storageRef : null);
    if ((row.outputsSpilled || marker) && ref) {
      const buffer = await this.storage.downloadFile(ref);
      return JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
    }
    return row.outputs;
  }
}
```

> Confirm the `NodeIORecord` field names for spill (`outputs`, `outputsSpilled`, `outputsStorageRef`) — they match `node-io.repository`/`node-io.service`. The `resolveOutputs` param is typed structurally to keep the spec's row mock simple; widen to `NodeIORecord` if the compiler prefers.

- [ ] **Step 4: Wire the module** — in `assets.module.ts`: add `NodeIOModule`, `WorkflowsModule`, `StorageModule` to `imports` (they export `NodeIORepository`, `WorkflowRunRepository`, `StorageService` respectively); add `AssetInventoryService` to `providers`. Keep `AssetsService` (read) unchanged. Guard against a circular import: `AssetsModule` importing `WorkflowsModule`/`NodeIOModule` is one-directional (neither imports `AssetsModule`).

- [ ] **Step 5: Emit the event** — in `backend/src/node-io/node-io-ingest.service.ts`:
  - Inject `EventEmitter2` (constructor param `private readonly eventEmitter: EventEmitter2` from `@nestjs/event-emitter`).
  - In `persistEvent`, in the `NODE_IO_COMPLETION` branch, AFTER `await this.nodeIORepository.recordCompletion(...)`, emit inside try/catch:

    ```ts
    try {
      this.eventEmitter.emit('asset.nodeio.completed', {
        runId: event.runId,
        nodeRef: event.nodeRef,
        componentId: event.componentId,
      });
    } catch (err) {
      this.logger.warn(`Failed to emit asset.nodeio.completed: ${err}`);
    }
    ```

  - `EventEmitterModule` is global, so no `NodeIOModule` import change is needed for the emit. (The listener lives in `AssetsModule`; decoupling is via the global emitter.)

- [ ] **Step 6: Run — passes.** `cd backend && bun test src/assets/` and `cd backend && bun test src/node-io/` (regression). Then `cd backend && bun run typecheck` and `cd backend && bunx eslint src/assets src/node-io/node-io-ingest.service.ts`.
- [ ] **Step 7: Commit** — `git add backend/src/assets backend/src/node-io/node-io-ingest.service.ts && git commit -m "feat(assets): auto-ingest recon assets into per-target inventory"`

---

### Task 6: Frontend Assets tab

**Files:** create `frontend/src/services/api/assets.ts`; modify `frontend/src/services/api/index.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/hooks/queries/useScopeQueries.ts`, `frontend/src/pages/target-detail/targetDetailTypes.ts`, `frontend/src/pages/target-detail/useTargetDetail.ts`, `frontend/src/pages/TargetDetailPage.tsx`, `frontend/src/routes.tsx`; test `frontend/src/pages/__tests__/TargetDetailPage.assets.test.tsx`.

**Interfaces produced:** `api.assets.listByScope(scopeId, opts?)`; `queryKeys.targets.assets(id)`; `useScopeAssets(scopeId)`; an **Assets** tab at `/targets/:id/assets`.

- [ ] **Step 1: api + query plumbing** —
  - `frontend/src/services/api/assets.ts` (mirror `scopes.ts` raw-helper style — import `httpGet` from `./client` to avoid the aggregator cycle):

    ```ts
    import type { Asset, AssetType } from '@/types/scopes';
    import { httpGet } from './client';

    export const assetsApi = {
      listByScope: (scopeId: string, opts?: { type?: AssetType }) =>
        httpGet<Asset[]>(`/scopes/${scopeId}/assets${opts?.type ? `?type=${opts.type}` : ''}`),
    };
    ```

  - Register `assets: assetsApi` in `frontend/src/services/api/index.ts` (import + add to the `api` object, next to `scopes`).
  - `frontend/src/lib/queryKeys.ts`: add under `targets` → `assets: (id: string) => ['targets', getOrgScope(), id, 'assets'] as const,` (mirror `runs`).
  - `frontend/src/hooks/queries/useScopeQueries.ts`: add, mirroring `useScopeRuns`:

    ```ts
    import type { Asset, AssetType } from '@/types/scopes';

    export function useScopeAssets(scopeId: string, type?: AssetType) {
      return useQuery({
        queryKey: [...queryKeys.targets.assets(scopeId), type ?? 'all'],
        queryFn: () => api.scopes && api.assets.listByScope(scopeId, type ? { type } : undefined),
        enabled: Boolean(scopeId),
      });
    }
    ```

    (Drop the `api.scopes &&` guard; use `queryFn: () => api.assets.listByScope(scopeId, type ? { type } : undefined)`.)

- [ ] **Step 2: Tab type + detail hook** —
  - `frontend/src/pages/target-detail/targetDetailTypes.ts`: change `TARGET_DETAIL_TABS` to `['overview', 'runs', 'assets'] as const`.
  - `frontend/src/pages/target-detail/useTargetDetail.ts`: add the `'/assets'` branch to `activeTab` (`if (location.pathname.endsWith('/assets')) return 'assets';`), call `useScopeAssets(scopeId)`, and return `assets` + `isLoadingAssets`.

- [ ] **Step 3: Failing test** — create `frontend/src/pages/__tests__/TargetDetailPage.assets.test.tsx` (mirror `TargetDetailPage.test.tsx`: render in `MemoryRouter` with `initialEntries`, mock `@/hooks/queries/useScopeQueries` for `useScope`/`useScopeRuns`/`useScopeAssets`). Cases:
  - (a) at `/targets/s1/assets` with one mocked asset `{ id:'a1', assetType:'subdomain', assetValue:'a.example.com', firstSeenAt, lastSeenAt, lastSeenRunId:'sentris-run-1', sourceComponentId:'sentris.subfinder.run', metadata:{} }` → the row shows `a.example.com` and a `subdomain` type badge;
  - (b) at `/targets/s1/assets` with `assets: []` → shows the empty state ("No assets yet" / "Discovered assets from recon runs against this target will appear here.");
  - (c) the **Assets** tab trigger exists at `/targets/s1`.
    Run `cd frontend && bun test src/pages/__tests__/TargetDetailPage.assets.test.tsx` — fails.

- [ ] **Step 4: Page tab + route** —
  - `frontend/src/pages/TargetDetailPage.tsx`: add `<TabsTrigger value="assets">Assets</TabsTrigger>` and a `<TabsContent value="assets">` with a `Table` (columns: Asset, Type badge, First seen `formatStartTime(firstSeenAt)`, Last seen `formatStartTime(lastSeenAt)`, Source `sourceComponentId ?? '—'`), a `RunHistorySkeleton`-style loading state, and an `EmptyState` (`icon={Target}`, title "No assets yet", description "Discovered assets from recon runs against this target will appear here."). Reuse the existing table/badge imports; add a small type-filter `Select` (All + the 8 `AssetType`s) that drives `useScopeAssets(scopeId, type)` — keep it minimal (optional local `useState` for the filter, passed into the hook via the hook return; if threading the filter through `useTargetDetail` is heavier than warranted, filter client-side over the returned list instead and note it).
  - `frontend/src/routes.tsx`: add `<Route path="/targets/:id/assets" element={<ErrorBoundary><TargetDetailPage /></ErrorBoundary>} />` next to the `/targets/:id/runs` route (same lazy `TargetDetailPage`).

- [ ] **Step 5: Run — passes.** `cd frontend && bun test src/pages/__tests__/TargetDetailPage.assets.test.tsx`, then regression `cd frontend && bun test src/pages/__tests__/TargetDetailPage.test.tsx`.
- [ ] **Step 6: Typecheck + lint + commit** — `cd frontend && bunx tsc --noEmit`; `cd frontend && bunx eslint src/services/api/assets.ts src/services/api/index.ts src/lib/queryKeys.ts src/hooks/queries/useScopeQueries.ts src/pages/target-detail/targetDetailTypes.ts src/pages/target-detail/useTargetDetail.ts src/pages/TargetDetailPage.tsx src/routes.tsx`. Then `git add frontend/src/services/api/assets.ts frontend/src/services/api/index.ts frontend/src/lib/queryKeys.ts frontend/src/hooks/queries/useScopeQueries.ts frontend/src/pages/target-detail frontend/src/pages/TargetDetailPage.tsx frontend/src/routes.tsx frontend/src/pages/__tests__/TargetDetailPage.assets.test.tsx && git commit -m "feat(targets): add Assets tab to target detail"`

---

### Task 7: E2E asset-ingestion slice

**Files:** create `e2e-tests/core/asset-inventory.test.ts` (mirror `e2e-tests/core/schedules.test.ts` structure: `checkServicesAvailable` gate, `e2eDescribe`/`e2eTest`, `API_BASE`/`HEADERS`); extend `e2e-tests/helpers/e2e-harness.ts` only if a scope-create/asset-list helper is missing.

> The implementing agent must NOT start the dev stack; this suite is authored to run against the user's running stack (or CI). Do NOT drive a real recon workflow against a live external host — exercise the read endpoint against seeded/known-empty scopes.

- [ ] **Step 1: Author the suite** — cases (each guarded by `checkServicesAvailable`):
  - **Setup:** create a scope via `POST /scopes` (reuse/add a `createScope` harness helper) → capture `scopeId`.
  - **Empty inventory:** `GET /scopes/:scopeId/assets` → `200` and `[]` for a fresh scope.
  - **Type filter is accepted:** `GET /scopes/:scopeId/assets?type=subdomain` → `200` and an array (empty is fine).
  - **Cascade delete:** `DELETE /scopes/:scopeId` → `204`; a subsequent `GET /scopes/:scopeId/assets` → `404`/`403` (scope gone; validates the FK-cascade path does not error).
  - **Unknown scope:** `GET /scopes/<random-uuid>/assets` → `404`.
  - (The live extract→upsert path — spill capture, `firstSeenAt` stability on re-run — is covered by the Task 5 unit spec; a full end-to-end recon run is intentionally omitted to avoid external scanning.)
- [ ] **Step 2: Lint** — `cd e2e-tests && bunx eslint core/asset-inventory.test.ts` (match how sibling e2e files are linted; skip if e2e-tests has no eslint config and instead `bunx tsc --noEmit` there). Do NOT run the suite here (requires the stack).
- [ ] **Step 3: Commit** — `git add e2e-tests/core/asset-inventory.test.ts e2e-tests/helpers/e2e-harness.ts && git commit -m "test(assets): add e2e asset ingestion slice"`

---

## Browser Verification (gate before Phase 5) — executed by the USER, SAFE, no external scanning

The implementing agent must NOT start the dev stack; hand these to the user. Do NOT launch a real recon run against a live external domain.

1. **Assets tab renders:** From Targets, open a target → the detail page now shows an **Assets** tab alongside Overview and Run History; `/targets/:id/assets` is a deep-linkable route; browser back/forward moves between tabs.
2. **Empty state:** a target with no ingested assets shows "No assets yet".
3. **Seeded assets display (no scanning):** `psql`-insert 2–3 `asset_inventory` rows for the target's `scope_id` (distinct `asset_type`/`asset_value`, `first_seen_at`/`last_seen_at` set, a `last_seen_run_id`) → the Assets tab lists them with value, type badge, first/last seen, source; the type filter narrows the list.
4. **Cascade:** delete that target → its `asset_inventory` rows are gone (`select count(*) from asset_inventory where scope_id = '<id>';` → 0), and the delete itself succeeds (FK cascade).
5. **Ingestion path (optional, safe):** the extract→recover→upsert path and `firstSeenAt` stability on re-run are proven by the Task 5 unit spec. To exercise the emitter end-to-end without external scanning, replay a recorded NODE_IO_COMPLETION for a recon component on a run stamped with a `scope_id`, and confirm rows appear; re-replay and confirm `first_seen_at` is unchanged while `last_seen_at`/`last_seen_run_id` advanced.
6. No console errors.

## Self-Review

- **Coverage vs. spec Phase 4:** schema + enum + cascade FK + re-export + migration (T1); pure extractor with allowlist + per-type `assetValue` derivation + table tests (T2); dedup upsert repository bumping last-seen only + spec (T3); `GET /scopes/:scopeId/assets` read module + service spec + OpenAPI + app.module registration (T4); emit wiring in the ingest consumer + `@OnEvent` listener with org/scope recovery, null guards, explicit-only feed, spill fetch, and never-throw resilience + integration spec (T5); frontend `useScopeAssets` + Assets tab + route + component test (T6); e2e slice (T7). ✓
- **Repo traps honored:** migration via `bun run migration:push` only, reported when run (T1 S4); router is `routes.tsx` and the tab lives on the existing route-driven `TargetDetailPage` (T6); `workflow_runs` dual-upsert is untouched (read-only via `findByRunId`); no `templateId` FK assumed; org-scoping uses the `.notNull()` finding-triage/agent-skills style; the CRUD read slice mirrors `agent-skills`/`scopes`, the cascade FK mirrors `finding-triage`. ✓
- **Accuracy caveats resolved:** (a) `NodeIORepository`/`NodeIOIngestService` do not inject `EventEmitter2` today — the emit is added to `NodeIOIngestService.persistEvent` (the consumer that already owns the completion payload) in T5 S5, decoupled via the global emitter so no module cycle is introduced. (b) `normalizeAllFindings` emits non-asset `type`s and a human `finding` string with no `asset_key` field — the extractor uses an explicit `TYPE_MAP` allowlist and a per-type `deriveAssetValue` (notably `open-port` = `host:port`, `http-probe` = `metadata.url`), and the `host`/`url` enum members are retained but intentionally not emitted in MVP (documented in Global Constraints). ✓
- **Type consistency:** `AssetType` union is identical across the schema enum (T1), the extractor (T2, imported from schema), the repository/service (T3/T4), the response DTO enum (T4), and the frontend type (T1). The upsert conflict target matches the unique index columns exactly. `NewAssetRecord` (write) and `AssetRecord`/`AssetResponse` (read) come from `$inferInsert`/`$inferSelect`. ✓
- **Placeholder scan:** the only verify-in-place notes are (i) confirm `AssetType` is exported from `assets.ts` for `import type` (T2 S3 — add the `enumValues` alias in T1 if the compiler needs it), (ii) confirm `NodeIORecord` spill field names (T5 S3), and (iii) the frontend type-filter placement trade-off (T6 S4). All are bounded, with the fallback stated inline. No fabricated APIs — `normalizeAllFindings`, `isSpilledDataMarker`, `StorageService.downloadFile`, `WorkflowRunRepository.findByRunId`, `NodeIORepository.findByRunAndNode`, `ScopesService.getScope`, `requireOrganizationId`, `formatStartTime`, `EmptyState` were all located in the codebase.
- **Resilience:** emit wrapped in try/catch at the chokepoint (T5 S5); listener body wrapped in try/catch that logs and never rethrows (T5 S3); spill fetch inside the same guard; non-recon fast-skip avoids DB reads for the common case. An ingestion failure cannot break `recordCompletion` (already awaited before the emit). ✓
