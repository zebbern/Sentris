# NPM Registry Intel Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable npm registry intelligence component and refactor the supply-chain takeover precursor template to use it.

**Architecture:** The new `sentris.npm.registry.intel` component fetches npm registry package metadata, normalizes package names from specs, and emits bounded package records plus risk signals. The existing `Supply Chain Takeover Precursor Hunt` template consumes those outputs instead of embedding registry fetch logic in a generic script.

**Tech Stack:** TypeScript, Sentris component SDK, Bun tests, npm registry public JSON API, seed workflow JSON.

---

### Task 1: Add Component Unit Tests

**Files:**
- Create: `worker/src/components/security/__tests__/npm-registry-intel.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests that register the component, mock `fetch`, execute it against package specs including `left-pad@1.3.0` and scoped names, and assert it emits:
- `records` with latest version, repository URL, maintainers, deprecation, and lifecycle script names.
- `riskSignals` for install scripts, missing repository metadata, deprecation, recent publish, and typosquat similarity.
- `summary` counts for packages checked, records fetched, warning count, and signal counts.

- [ ] **Step 2: Verify red**

Run: `bun test worker/src/components/security/__tests__/npm-registry-intel.test.ts`

Expected: fails because `../npm-registry-intel` and `sentris.npm.registry.intel` do not exist.

### Task 2: Implement Component

**Files:**
- Create: `worker/src/components/security/npm-registry-intel.ts`
- Modify: `worker/src/components/security/register-all.ts`
- Modify: `worker/src/components/security/security-component-manifest.ts`
- Modify: `scripts/security-component-audit-utils.ts`
- Modify: `docs/components/security.mdx`

- [ ] **Step 1: Implement schemas and execution**

Create `sentris.npm.registry.intel` with:
- Inputs: `packageSpecs`, `typosquatCandidates`
- Parameters: `maxPackages`, `recentPublishDays`, `includeRawMetadata`
- Outputs: `records`, `riskSignals`, `summary`, `warnings`

The component must use `https://registry.npmjs.org/<encoded package name>`, never execute package tarballs or scripts, cap package count, handle 404s as warnings, and produce deterministic risk scoring.

- [ ] **Step 2: Register and document**

Add the component to `register-all.ts`, `SECURITY_COMPONENT_IDS`, the live audit fixture map, and `docs/components/security.mdx`. Update the documented component count from 28 to 29.

- [ ] **Step 3: Verify green**

Run: `bun test worker/src/components/security/__tests__/npm-registry-intel.test.ts`

Expected: all tests pass.

### Task 3: Refactor Template

**Files:**
- Modify: `backend/scripts/seed-templates/supply-chain-takeover-precursor-hunt.json`
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`

- [ ] **Step 1: Add node and edges**

Insert a `sentris.npm.registry.intel` node after the entrypoint. Connect package specs and typosquat comparison names into it. Connect `records`, `riskSignals`, `summary`, and `warnings` into the existing brief assembly script.

- [ ] **Step 2: Remove embedded fetch**

Change the brief assembly script so it consumes `registryRecords`, `registryRiskSignals`, `registrySummary`, and `registryWarnings` from the component. Keep OSV malicious advisory ranking in the script.

- [ ] **Step 3: Update seed test**

Update the existing supply-chain precursor test to provide component-shaped registry outputs and assert the template contains `sentris.npm.registry.intel`.

### Task 4: Focused Verification

**Files:**
- No additional source files.

- [ ] **Step 1: Component tests**

Run: `bun test worker/src/components/security/__tests__/npm-registry-intel.test.ts`

Expected: pass.

- [ ] **Step 2: Seed template tests**

Run: `bun test backend/src/templates/__tests__/seed-templates.spec.ts`

Expected: pass.

- [ ] **Step 3: Catalog checks**

Run: `bun run security-components:check`

Expected: stale only for `sentris.npm.registry.intel` until a live audit is run.

Run: `bun run security-components:audit -- --filter sentris.npm.registry.intel --force`

Expected: component live audit passes and ledger records the new component.

Run: `bun run template-library:check`

Expected: the affected template is stale because its graph changed.

Run: `bun run template-library:audit -- --name "Supply Chain Takeover Precursor Hunt" --force`

Expected: targeted template live audit passes.
