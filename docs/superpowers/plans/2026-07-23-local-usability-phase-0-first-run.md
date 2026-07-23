# Local Usability — Phase 0: First-Run Quick Wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a brand-new local user's first visit obviously actionable — surface the templates that run with no setup, funnel onboarding to them, and stop the empty Template Library from dead-ending non-admins.

**Architecture:** Pure frontend. A small pure helper classifies each template's setup level from its graph node component types + required secrets (allowlist: unknown components default to "needs setup"). A "No setup required" badge and a client-side filter toggle key off that helper; the onboarding checklist deep-links into the filtered library; the empty state gets a non-admin-friendly branch. No backend, no schema, no new dependencies.

**Tech Stack:** React 18 + TypeScript, TanStack Query, shadcn/ui, lucide-react, `bun:test` + `@testing-library/react` + jsdom.

## Global Constraints

- **No backend or schema changes in Phase 0.** All work is under `frontend/src/`.
- **Test runner:** `bun test` via `bun:test`; frontend tests are co-located in `__tests__/` and run through `bun run test` (which invokes `src/test/run-tests-serial.ts`). Component tests use `@testing-library/react` with the existing module-mock helpers under `@/test/`.
- **Node/component classification is an allowlist.** A template is "no setup" only if it has zero required secrets AND every graph node's `type` is in `NET_ONLY_COMPONENT_TYPES`. Never invert to a denylist — an unknown/new component must default to "needs setup," never to "no setup."
- **Commit after every task** with a `feat:`/`test:` conventional message.
- **Branch:** work continues on `feat/local-usability-scopes` (already checked out).
- **Honesty rule for copy:** "No setup required" means _no credentials and no Docker images_ — the user may still type a target/CVE into the run dialog. Tooltip copy must say exactly that.

---

## File Structure

- **Create** `frontend/src/pages/template-library/setupLevel.ts` — pure classification: `NET_ONLY_COMPONENT_TYPES`, `SetupLevel` type, `getTemplateSetupLevel(template)`.
- **Create** `frontend/src/pages/template-library/__tests__/setupLevel.test.ts` — unit tests for the helper.
- **Modify** `frontend/src/pages/template-library/TemplateCard.tsx` — render a "No setup required" badge when level is `no-setup`.
- **Modify** `frontend/src/pages/template-library/TemplateFilters.tsx` — add a "No setup required" toggle button (new props).
- **Modify** `frontend/src/pages/TemplateLibraryPage.tsx` — `showNoSetupOnly` state, client-side filter, fold into `hasFilters`/`clearFilters`, read `?setup=none` deep-link, improve empty state.
- **Modify** `frontend/src/pages/template-library/index.ts` — export the new helper (if the folder uses a barrel; verify in Task 1).
- **Modify** `frontend/src/components/shared/OnboardingChecklist.tsx` — add `href` to steps 2 and 3; step 3 → `/templates?setup=none`.
- **Modify** `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx` — add coverage for the toggle + deep-link (extends existing suite).

Roadmap note: Phases 1–5 from the design spec each get their own plan when reached. This plan is Phase 0 only and is independently shippable.

---

### Task 1: `getTemplateSetupLevel` classification helper

**Files:**

- Create: `frontend/src/pages/template-library/setupLevel.ts`
- Test: `frontend/src/pages/template-library/__tests__/setupLevel.test.ts`
- Modify (verify barrel): `frontend/src/pages/template-library/index.ts`

**Interfaces:**

- Consumes: `Template` from `@/types/templates` (has `requiredSecrets: {name;type;description?}[]` and `graph?: Record<string, unknown>` where `graph.nodes` is an array of `{ id: string; type?: string }`).
- Produces:
  - `type SetupLevel = 'no-setup' | 'needs-secrets' | 'needs-tooling'`
  - `const NET_ONLY_COMPONENT_TYPES: ReadonlySet<string>`
  - `function getTemplateSetupLevel(template: Pick<Template, 'graph' | 'requiredSecrets'>): SetupLevel`
  - `function isNoSetupTemplate(template: Pick<Template, 'graph' | 'requiredSecrets'>): boolean`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/template-library/__tests__/setupLevel.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { getTemplateSetupLevel, isNoSetupTemplate } from '../setupLevel';

// Minimal template shape the helper reads.
function tpl(nodeTypes: string[], requiredSecrets: { name: string; type: string }[] = []) {
  return {
    graph: { nodes: nodeTypes.map((type, i) => ({ id: `n${i}`, type })) },
    requiredSecrets,
  };
}

describe('getTemplateSetupLevel', () => {
  it('classifies a net-only template as no-setup', () => {
    // Mirrors kev-fresh-cve-watch-brief / npm-dependency-cve-hunt component sets.
    const t = tpl([
      'core.workflow.entrypoint',
      'sentris.nvd.cve.query',
      'core.http.request',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(getTemplateSetupLevel(t)).toBe('no-setup');
    expect(isNoSetupTemplate(t)).toBe(true);
  });

  it('classifies a template with a Docker scanner as needs-tooling', () => {
    // Mirrors subdomain-takeover-triage.
    const t = tpl([
      'core.workflow.entrypoint',
      'sentris.subfinder.run',
      'sentris.nuclei.scan',
      'core.artifact.writer',
    ]);
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
    expect(isNoSetupTemplate(t)).toBe(false);
  });

  it('classifies a template requiring secrets as needs-secrets even if all nodes are net-only', () => {
    const t = tpl(
      ['core.workflow.entrypoint', 'core.http.request'],
      [{ name: 'API_KEY', type: 'api_key' }],
    );
    expect(getTemplateSetupLevel(t)).toBe('needs-secrets');
    expect(isNoSetupTemplate(t)).toBe(false);
  });

  it('treats an unknown component type as needs-tooling (allowlist, not denylist)', () => {
    const t = tpl(['core.workflow.entrypoint', 'sentris.some.future.scanner']);
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
  });

  it('handles a missing/empty graph as needs-tooling (cannot prove it is net-only)', () => {
    expect(getTemplateSetupLevel({ graph: undefined, requiredSecrets: [] })).toBe('needs-tooling');
    expect(getTemplateSetupLevel({ graph: { nodes: [] }, requiredSecrets: [] })).toBe(
      'needs-tooling',
    );
  });

  it('ignores nodes with no type by treating them as non-net-only (safe default)', () => {
    const t = tpl(['core.workflow.entrypoint', 'core.http.request']);
    // add a typeless node
    (t.graph.nodes as { id: string; type?: string }[]).push({ id: 'x' });
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun test src/pages/template-library/__tests__/setupLevel.test.ts`
Expected: FAIL — cannot find module `../setupLevel`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/template-library/setupLevel.ts`:

```ts
import type { Template } from '@/types/templates';

/**
 * Component `type` values (React Flow node.type === componentId) that run with
 * ONLY outbound internet — no Docker image pull, no local tooling, no target
 * infrastructure. This is an ALLOWLIST: any component NOT listed here is treated
 * as requiring setup. When a new inline/API-only component is added, add its id
 * here deliberately.
 *
 * Source of truth for a component's runtime is the worker component manifest
 * (worker/src/components/**). Keep this set in sync with the inline/API-only
 * security + core components.
 */
export const NET_ONLY_COMPONENT_TYPES: ReadonlySet<string> = new Set<string>([
  // core inline components
  'core.workflow.entrypoint',
  'core.logic.script',
  'core.http.request',
  'core.artifact.writer',
  // API-only intel components (no Docker)
  'sentris.nvd.cve.query',
  'sentris.osv.query',
  'sentris.npm.registry.intel',
]);

export type SetupLevel = 'no-setup' | 'needs-secrets' | 'needs-tooling';

type Classifiable = Pick<Template, 'graph' | 'requiredSecrets'>;

function nodeTypes(graph: Template['graph']): (string | undefined)[] {
  if (!graph || typeof graph !== 'object') return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((n) => (n && typeof n === 'object' ? (n as { type?: unknown }).type : undefined))
    .map((t) => (typeof t === 'string' ? t : undefined));
}

/**
 * Classify how much setup a template needs before it can run locally.
 * - needs-secrets: has one or more required secrets.
 * - no-setup: zero secrets AND every graph node is a net-only component.
 * - needs-tooling: anything else (Docker scanner, unknown component, empty graph).
 */
export function getTemplateSetupLevel(template: Classifiable): SetupLevel {
  if (template.requiredSecrets && template.requiredSecrets.length > 0) {
    return 'needs-secrets';
  }
  const types = nodeTypes(template.graph);
  if (types.length === 0) return 'needs-tooling';
  const allNetOnly = types.every((t) => t !== undefined && NET_ONLY_COMPONENT_TYPES.has(t));
  return allNetOnly ? 'no-setup' : 'needs-tooling';
}

export function isNoSetupTemplate(template: Classifiable): boolean {
  return getTemplateSetupLevel(template) === 'no-setup';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && bun test src/pages/template-library/__tests__/setupLevel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export from the folder barrel**

The barrel `frontend/src/pages/template-library/index.ts` exists (it exports `TemplateCard`, `TemplateFilters`, `getCategoryStyle`, etc.). Add these lines to it:

```ts
export { NET_ONLY_COMPONENT_TYPES, getTemplateSetupLevel, isNoSetupTemplate } from './setupLevel';
export type { SetupLevel } from './setupLevel';
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/template-library/setupLevel.ts frontend/src/pages/template-library/__tests__/setupLevel.test.ts frontend/src/pages/template-library/index.ts
git commit -m "feat: classify template setup level for first-run spotlight"
```

---

### Task 2: "No setup required" badge on the template card

**Files:**

- Modify: `frontend/src/pages/template-library/TemplateCard.tsx`
- Test: `frontend/src/pages/template-library/__tests__/TemplateCard.setup-badge.test.tsx` (create)

**Interfaces:**

- Consumes: `isNoSetupTemplate` from `./setupLevel` (Task 1).
- Produces: no new exported API; adds a badge element with text `No setup required` inside the existing `TemplateCard`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/template-library/__tests__/TemplateCard.setup-badge.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { Template } from '@/types/templates';
import { TemplateCard } from '../TemplateCard';

afterEach(cleanup);

function makeTemplate(
  nodeTypes: string[],
  requiredSecrets: Template['requiredSecrets'] = [],
): Template {
  return {
    id: 't1',
    name: 'demo template',
    tags: [],
    repository: 'r',
    path: 'p',
    branch: 'main',
    manifest: {},
    graph: { nodes: nodeTypes.map((type, i) => ({ id: `n${i}`, type })) },
    requiredSecrets,
    popularity: 0,
    isOfficial: false,
    isVerified: false,
    isActive: true,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

describe('TemplateCard no-setup badge', () => {
  it('shows the badge for a net-only template', () => {
    const t = makeTemplate([
      'core.workflow.entrypoint',
      'sentris.nvd.cve.query',
      'core.artifact.writer',
    ]);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse />);
    expect(screen.getByText('No setup required')).toBeDefined();
  });

  it('does not show the badge for a Docker-scanner template', () => {
    const t = makeTemplate(['core.workflow.entrypoint', 'sentris.nuclei.scan']);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse />);
    expect(screen.queryByText('No setup required')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun test src/pages/template-library/__tests__/TemplateCard.setup-badge.test.tsx`
Expected: FAIL — `getByText('No setup required')` throws (badge not rendered).

- [ ] **Step 3: Add the badge to `TemplateCard.tsx`**

At the top of `frontend/src/pages/template-library/TemplateCard.tsx`, update imports:

```tsx
import { Star, KeyRound, ArrowRight, Zap } from 'lucide-react';
import { isNoSetupTemplate } from './setupLevel';
```

Inside `TemplateCard`, compute the flag right after the function opens:

```tsx
export function TemplateCard({ template, onUse, onPreview, canUse }: TemplateCardProps) {
  const noSetup = isNoSetupTemplate(template);

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
```

Then, immediately inside `<div className="flex flex-1 flex-col gap-4 p-4">` and BEFORE `<PreviewSection ... />`, add the badge:

```tsx
      <div className="flex flex-1 flex-col gap-4 p-4">
        {noSetup && (
          <span
            className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
            title="Runs with only outbound internet — no API keys or Docker images required. You may still enter a target in the run dialog."
          >
            <Zap className="h-3 w-3" />
            No setup required
          </span>
        )}

        <PreviewSection
          graph={template.graph}
          category={template.category}
          onPreviewClick={() => onPreview(template)}
        />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && bun test src/pages/template-library/__tests__/TemplateCard.setup-badge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/template-library/TemplateCard.tsx frontend/src/pages/template-library/__tests__/TemplateCard.setup-badge.test.tsx
git commit -m "feat: show No setup required badge on net-only templates"
```

---

### Task 3: "No setup required" filter toggle + deep-link

**Files:**

- Modify: `frontend/src/pages/template-library/TemplateFilters.tsx`
- Modify: `frontend/src/pages/TemplateLibraryPage.tsx`
- Test: `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx` (extend existing suite)

**Interfaces:**

- Consumes: `isNoSetupTemplate` from `./template-library` (or `./template-library/setupLevel`), `useSearchParams` from `react-router-dom`.
- Produces:
  - `TemplateFilters` gains two props: `noSetupOnly: boolean` and `onToggleNoSetupOnly: () => void`.
  - `TemplateLibraryPage` gains local state `showNoSetupOnly` and applies a client-side filter to the template list.

- [ ] **Step 1: Add props + toggle button to `TemplateFilters.tsx`**

Update `TemplateFiltersProps` (add two fields) and the destructure:

```tsx
export interface TemplateFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (category: string) => void;
  categories: TemplateCategoryInfo[];
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  onSync: () => void;
  isSyncing: boolean;
  canManageWorkflows: boolean;
  noSetupOnly: boolean;
  onToggleNoSetupOnly: () => void;
}
```

Add `Zap` to the lucide import:

```tsx
import { Filter, RefreshCw, Search, Tag, X, ExternalLink, Zap } from 'lucide-react';
```

Destructure the new props in the function signature (add `noSetupOnly` and `onToggleNoSetupOnly` to the existing list). Then, inside the tag row `<div className="flex flex-wrap items-center gap-1.5 ml-1">` is only rendered when `tags.length > 0`; to keep the toggle always visible, add it as its own row BEFORE the tags block, right after the top filter row's closing `</div>` (the one closing `flex flex-col sm:flex-row gap-3`):

```tsx
<div className="flex flex-wrap items-center gap-2 ml-1">
  <button
    type="button"
    onClick={onToggleNoSetupOnly}
    aria-pressed={noSetupOnly}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
      noSetupOnly
        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
        : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
    )}
  >
    <Zap className="h-3.5 w-3.5" />
    No setup required
  </button>
</div>
```

- [ ] **Step 2: Wire state + client filter + deep-link into `TemplateLibraryPage.tsx`**

Add imports at the top:

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isNoSetupTemplate } from './template-library';
```

(If Task 1 Step 5 did not add a barrel export, import from `'./template-library/setupLevel'` instead.)

After the existing `const [searchQuery, setSearchQuery] = useState('');` line, add:

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const [showNoSetupOnly, setShowNoSetupOnly] = useState(() => searchParams.get('setup') === 'none');
```

Change the `hasFilters` line to include the toggle:

```tsx
const hasFilters = Boolean(
  selectedCategory || selectedTags.length > 0 || searchQuery || showNoSetupOnly,
);
```

Update `clearFilters` to also reset the toggle and clear the query param:

```tsx
const clearFilters = () => {
  setSelectedCategory(null);
  setSelectedTags([]);
  setSearchQuery('');
  setShowNoSetupOnly(false);
  if (searchParams.has('setup')) {
    searchParams.delete('setup');
    setSearchParams(searchParams, { replace: true });
  }
};
```

Add a toggle handler near `toggleTag`:

```tsx
const toggleNoSetupOnly = () => {
  setShowNoSetupOnly((prev) => {
    const next = !prev;
    if (next) searchParams.set('setup', 'none');
    else searchParams.delete('setup');
    setSearchParams(searchParams, { replace: true });
    return next;
  });
};
```

Apply the client-side filter to the fetched templates. Replace the `useSortableList({ items: templates, ... })` input with a derived, filtered list. Immediately after `const { data: templates = [], isLoading, error, refetch } = useTemplates(filters);` add:

```tsx
const visibleTemplates = useMemo(
  () => (showNoSetupOnly ? templates.filter(isNoSetupTemplate) : templates),
  [templates, showNoSetupOnly],
);
```

Then change the sortable-list source and the empty-state check from `templates` to `visibleTemplates`:

- `useSortableList({ items: visibleTemplates, ... })`
- the render guard `templates.length === 0` → `visibleTemplates.length === 0`
- `error && templates.length === 0 ? null` → `error && visibleTemplates.length === 0 ? null`

Pass the new props into `<TemplateFilters ... />`:

```tsx
noSetupOnly = { showNoSetupOnly };
onToggleNoSetupOnly = { toggleNoSetupOnly };
```

- [ ] **Step 3: Write the failing test (extends the existing suite)**

In `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx`, the suite already builds `mockQueryState.templates`. Add a new `describe` block at the end of the file (before the final closing brace of the outer describe, or as a sibling). Use two templates — one net-only, one Docker — and assert the toggle filters. Add this test, matching the file's existing render helper (it renders `<TemplateLibraryPage />` inside `<MemoryRouter>`; reuse whatever `renderPage()`/setup exists — if the suite renders inline, mirror that):

```tsx
import { getTemplateSetupLevel } from '@/pages/template-library/setupLevel';

// ... within the existing suite, after other tests:

it('filters to net-only templates when "No setup required" is toggled', () => {
  mockQueryState.templates = [
    {
      id: 'net',
      name: 'net only',
      tags: [],
      repository: 'r',
      path: 'p',
      branch: 'main',
      manifest: {},
      graph: {
        nodes: [
          { id: 'a', type: 'core.workflow.entrypoint' },
          { id: 'b', type: 'sentris.nvd.cve.query' },
        ],
      },
      requiredSecrets: [],
      popularity: 0,
      isOfficial: false,
      isVerified: false,
      isActive: true,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
    {
      id: 'docker',
      name: 'docker scan',
      tags: [],
      repository: 'r',
      path: 'p',
      branch: 'main',
      manifest: {},
      graph: {
        nodes: [
          { id: 'a', type: 'core.workflow.entrypoint' },
          { id: 'b', type: 'sentris.nuclei.scan' },
        ],
      },
      requiredSecrets: [],
      popularity: 0,
      isOfficial: false,
      isVerified: false,
      isActive: true,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
  ] as Template[];

  render(
    <MemoryRouter>
      <TemplateLibraryPage />
    </MemoryRouter>,
  );

  // Both visible initially.
  expect(screen.getByText('Net Only')).toBeDefined();
  expect(screen.getByText('Docker Scan')).toBeDefined();

  // Toggle "No setup required".
  fireEvent.click(screen.getByRole('button', { name: /No setup required/i }));

  expect(screen.getByText('Net Only')).toBeDefined();
  expect(screen.queryByText('Docker Scan')).toBeNull();
  // sanity: helper agrees
  expect(getTemplateSetupLevel(mockQueryState.templates[1])).toBe('needs-tooling');
});
```

Note: template names render through `toTitleCase`, so `net only` displays as `Net Only`. Confirmed: `createUseSortableListMock` (`frontend/src/test/mocks/dnd-kit.tsx:140`) returns `orderedItems: items` unchanged, so the client-side filter in the page determines what renders.

- [ ] **Step 4: Run tests to verify (new fails first, then passes after Steps 1–2)**

Because Steps 1–2 already implement the behavior, run the whole file:

Run: `cd frontend && bun test src/pages/__tests__/TemplateLibraryPage.test.tsx`
Expected: PASS including the new test. If the new test is written before Steps 1–2 in a strict TDD pass, it FAILS with "No setup required" button not found; after Steps 1–2 it PASSES.

- [ ] **Step 5: Typecheck + lint the touched files**

Run: `cd frontend && bunx tsc --noEmit`
Expected: no errors.
Run: `cd frontend && bunx eslint src/pages/TemplateLibraryPage.tsx src/pages/template-library/TemplateFilters.tsx`
Expected: no errors (no `any`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/template-library/TemplateFilters.tsx frontend/src/pages/TemplateLibraryPage.tsx frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx
git commit -m "feat: add No setup required filter with deep-link to template library"
```

---

### Task 4: Onboarding checklist deep-links

**Files:**

- Modify: `frontend/src/components/shared/OnboardingChecklist.tsx`
- Test: `frontend/src/components/shared/__tests__/OnboardingChecklist.test.tsx` (create if absent)

**Interfaces:**

- Consumes: nothing new. The `ChecklistItem` already supports `href?: string` and renders it as a `<Link>` when the item is not complete.
- Produces: steps `add-component` and `run-workflow` gain hrefs.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/__tests__/OnboardingChecklist.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingChecklist } from '../OnboardingChecklist';

afterEach(cleanup);

describe('OnboardingChecklist deep-links', () => {
  it('links the "Run a workflow" step to the no-setup template library', () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist
          totalWorkflows={0}
          hasWorkflowWithNodes={false}
          totalRuns={0}
          isLoading={false}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Run a workflow' });
    expect(link.getAttribute('href')).toBe('/templates?setup=none');
  });

  it('links the "Add a component" step to the workflow builder', () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist
          totalWorkflows={0}
          hasWorkflowWithNodes={false}
          totalRuns={0}
          isLoading={false}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Add a component to your workflow' });
    expect(link.getAttribute('href')).toBe('/workflows/new');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun test src/components/shared/__tests__/OnboardingChecklist.test.tsx`
Expected: FAIL — the "Run a workflow" and "Add a component" items have no `href`, so no `<Link>`/`role="link"` is rendered.

- [ ] **Step 3: Add hrefs in `OnboardingChecklist.tsx`**

In the `items` array (inside the `useMemo`), add `href` to the two items:

```tsx
      {
        id: 'add-component',
        label: 'Add a component to your workflow',
        description: 'Drag components from the palette onto the canvas.',
        icon: Puzzle,
        isComplete: hasWorkflowWithNodes,
        href: '/workflows/new',
      },
      {
        id: 'run-workflow',
        label: 'Run a workflow',
        description: 'Start with a template that needs no setup — just outbound internet.',
        icon: Play,
        isComplete: totalRuns > 0,
        href: '/templates?setup=none',
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && bun test src/components/shared/__tests__/OnboardingChecklist.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/OnboardingChecklist.tsx frontend/src/components/shared/__tests__/OnboardingChecklist.test.tsx
git commit -m "feat: deep-link onboarding steps to builder and no-setup templates"
```

---

### Task 5: Non-admin-friendly empty state

**Files:**

- Modify: `frontend/src/pages/TemplateLibraryPage.tsx`
- Test: `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx` (extend)

**Interfaces:**

- Consumes: existing `EmptyState`, `Button`, `canManageWorkflows`, `hasFilters`.
- Produces: the no-filter empty state renders an admin "Sync templates" button OR a non-admin explanation + "Browse templates on GitHub" link.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx` a test that sets `mockRoles = []` (non-admin — check how the suite toggles roles; it uses `mockRoles` per the file header) and an empty template list, then asserts the non-admin copy:

```tsx
it('shows a non-admin-friendly empty state when the library is empty and user cannot sync', () => {
  mockRoles = [];
  mockQueryState.templates = [];

  render(
    <MemoryRouter>
      <TemplateLibraryPage />
    </MemoryRouter>,
  );

  expect(screen.getByText(/synced from GitHub by an administrator/i)).toBeDefined();
  const link = screen.getByRole('link', { name: /Browse templates on GitHub/i });
  expect(link.getAttribute('href')).toContain('github.com');
  // The admin-only Sync button must NOT be the CTA here.
  expect(screen.queryByRole('button', { name: /Sync templates/i })).toBeNull();
});
```

Reset `mockRoles = ['ADMIN']` in the suite's `beforeEach`/`afterEach` if it doesn't already (the file initializes `let mockRoles: string[] = ['ADMIN'];` — ensure each test restores it; add `mockRoles = ['ADMIN'];` to the existing `beforeEach` if not present).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && bun test src/pages/__tests__/TemplateLibraryPage.test.tsx`
Expected: FAIL — the non-admin branch currently renders `undefined` action and generic copy.

- [ ] **Step 3: Update the empty state in `TemplateLibraryPage.tsx`**

Replace the `EmptyState` `description` and `action` props for the no-filter case. Change the `description`:

```tsx
            description={
              hasFilters
                ? "Try adjusting your filters or search query to find what you're looking for."
                : canManageWorkflows
                  ? 'No templates available yet. Sync from GitHub to load the template library.'
                  : 'No templates available yet. The library is synced from GitHub by an administrator — ask an admin to run a sync, or browse the catalog on GitHub.'
            }
```

Change the `action`:

```tsx
            action={
              hasFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : canManageWorkflows ? (
                <Button onClick={handleSync} disabled={isSyncing}>
                  {isSyncing ? 'Syncing…' : 'Sync templates'}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  asChild
                >
                  <a
                    href="https://github.com/zebbern/Sentris"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Browse templates on GitHub
                  </a>
                </Button>
              )
            }
```

Note: `Button asChild` renders its child `<a>` as the element, so `getByRole('link')` resolves. Confirmed: `frontend/src/components/ui/button.tsx` supports `asChild` via Radix `Slot`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && bun test src/pages/__tests__/TemplateLibraryPage.test.tsx`
Expected: PASS including the new non-admin test.

- [ ] **Step 5: Full Phase 0 test + typecheck sweep**

Run: `cd frontend && bun test src/pages/template-library src/pages/__tests__/TemplateLibraryPage.test.tsx src/components/shared/__tests__/OnboardingChecklist.test.tsx`
Expected: all PASS.
Run: `cd frontend && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TemplateLibraryPage.tsx frontend/src/pages/__tests__/TemplateLibraryPage.test.tsx
git commit -m "feat: give template library a non-admin-friendly empty state"
```

---

## Self-Review

**Spec coverage (Phase 0 items from the design):**

- "No setup required" badge + filter keyed off `requiredSecrets.length === 0` AND absence of Docker/AI node types → Task 1 (helper), Task 2 (badge), Task 3 (filter). ✓
- Onboarding checklist steps get real hrefs; step 3 deep-links to spotlighted no-setup templates → Task 4. ✓
- One-click demo run = spotlight a net-only template → delivered as the `?setup=none` deep-link + filter (Tasks 3–4); a true one-click _execute_ is deferred to Phase 5 per the spec. ✓ (interpretation noted)
- Empty-state fix so non-admins aren't dead-ended → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `getTemplateSetupLevel`/`isNoSetupTemplate`/`SetupLevel`/`NET_ONLY_COMPONENT_TYPES` are defined in Task 1 and consumed with the same names in Tasks 2–3. `TemplateFilters` prop names (`noSetupOnly`, `onToggleNoSetupOnly`) match between the component (Task 3 Step 1) and the page wiring (Task 3 Step 2). `ChecklistItem.href` already exists in the component. ✓

**Pre-verified environment facts** (checked against the codebase while writing this plan): the folder barrel `template-library/index.ts` exists and uses named exports (Task 1 Step 5); `createUseSortableListMock` returns `orderedItems: items` unchanged (Task 3 Step 3); shadcn `Button` supports `asChild` via Radix `Slot` (Task 5 Step 3). No open assumptions remain.
