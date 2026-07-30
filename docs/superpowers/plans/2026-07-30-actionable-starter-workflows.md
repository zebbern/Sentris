# Actionable Starter Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two distinct no-secret starter workflows, surface deterministic actionable report summaries, and preserve Recommended templates on fresh open-source installs.

**Architecture:** The template stream adds two seed graphs using existing entrypoint, script, HTTP, and artifact components. The frontend stream reuses the existing artifact list and preview queries, parses common report envelopes with pure helpers, and renders bounded plain-text metrics/actions. Recommendation fallback remains a frontend classification rule and never overrides stale or failed live evidence.

**Tech Stack:** TypeScript, React, TanStack Query, Bun tests, NestJS seed graphs, existing Sentris component contracts.

## Global Constraints

- Do not add production dependencies, database migrations, backend routes, AI calls, or credential requirements.
- Treat concurrent design edits not created by this plan as user-owned and leave them untouched.
- Use only `core.workflow.entrypoint`, `core.logic.script`, `core.http.request`, and `core.artifact.writer` in the new templates.
- Every template must write a useful JSON artifact even when a public source is unavailable.
- Render artifact-derived content as plain React text; never interpret HTML or Markdown.
- Cap rendered metrics at four, warnings/notices at one, and next actions at two.
- Keep current or stale live-validation evidence authoritative over the reviewed-seed fallback.

---

### Task 1: Two gap-filling starter templates

**Files:**

- Create: `backend/scripts/seed-templates/domain-email-authentication-posture.json`
- Create: `backend/scripts/seed-templates/oidc-discovery-configuration-review.json`
- Modify: `backend/src/templates/__tests__/seed-templates.spec.ts`
- Modify: `packages/shared/src/template-validation-fingerprint.ts`
- Modify: `scripts/__tests__/template-library-live-audit-utils.test.ts`

**Interfaces:**

- Consumes: existing workflow seed schema, `core.http.request` output handles `status`, `statusText`, `headers`, `data`, and `rawBody`.
- Produces: two official templates whose artifacts use `{ summary, findings, warnings, nextSteps }`.

- [ ] **Step 1: Add failing catalog and live-input assertions**

Add both filenames to `newTemplateFiles`. Add focused assertions that:

```ts
expect(template.requiredSecrets).toEqual([]);
expect(template.graph.nodes.map((node: { type: string }) => node.type)).toEqual(
  expect.arrayContaining([
    'core.workflow.entrypoint',
    'core.logic.script',
    'core.http.request',
    'core.artifact.writer',
  ]),
);
```

Execute each assembler with representative input and assert:

```ts
expect(result.report.summary.findings).toBeGreaterThanOrEqual(0);
expect(result.report.nextSteps.length).toBeGreaterThan(0);
expect(result.report.warnings).toEqual(expect.any(Array));
```

Extend `createTemplateLiveAuditInputs()` with:

```ts
'Domain Email Authentication Posture': {
  domain: 'example.com',
  authorizationNotes: 'Live audit fixture: public DNS records only.',
},
'OIDC Discovery Configuration Review': {
  issuerUrl: 'https://accounts.google.com',
  authorizationNotes: 'Live audit fixture: public OIDC discovery metadata only.',
},
```

Assert those exact fixtures in `scripts/__tests__/template-library-live-audit-utils.test.ts`.

- [ ] **Step 2: Run tests and confirm the missing seeds fail**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun test scripts/__tests__/template-library-live-audit-utils.test.ts
```

Expected: the seed catalog test fails because both JSON files are absent; live-input assertions fail until the shared map is updated.

- [ ] **Step 3: Implement Domain Email Authentication Posture**

Create a seven-node graph:

```text
trigger_1
  → build_dns_queries
  → fetch_root_txt
  → fetch_dmarc_txt
  → fetch_mx
  → assemble_email_posture
  → artifact_report
```

The three HTTP requests run from builder outputs and converge on the assembler. Use:

```ts
const dohUrl = (name: string, type: string) =>
  `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
```

Normalize a supplied domain by removing scheme, path, port, trailing dot, and leading `www.`. Reject an empty or invalid hostname by routing requests to `invalid.invalid`, then report a warning.

The assembler must:

```ts
const spfRecords = rootAnswers.filter(
  (answer) => answer.type === 16 && /^v=spf1\b/i.test(unquote(answer.data)),
);
const dmarcRecords = dmarcAnswers.filter(
  (answer) => answer.type === 16 && /^v=dmarc1\b/i.test(unquote(answer.data)),
);
const mxRecords = mxAnswers.filter((answer) => answer.type === 15);
```

Create findings for missing/multiple SPF, missing DMARC, `p=none`, `pct<100`, and missing MX. Do not claim DKIM coverage. Return raw observed records, source statuses, warnings, and prioritized next steps. Set the artifact name to `domain-email-authentication-posture-{{date}}`.

- [ ] **Step 4: Implement OIDC Discovery Configuration Review**

Create a five-node graph:

```text
trigger_1
  → build_discovery_request
  → fetch_discovery
  → assemble_oidc_review
  → artifact_report
```

Normalize the issuer by requiring `https:` and removing query/hash/trailing slash. Build:

```ts
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
```

The assembler accepts `status`, `statusText`, `data`, and `rawBody`. It must create evidence-backed observations for:

```ts
metadata.issuer !== expectedIssuer;
['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint'].some(
  (key) => metadata[key] && !String(metadata[key]).startsWith('https://'),
);
!asArray(metadata.code_challenge_methods_supported).includes('S256');
asArray(metadata.id_token_signing_alg_values_supported).includes('none');
asArray(metadata.response_types_supported).some((value) =>
  /\btoken\b|\bid_token\s+token\b|\bcode\s+id_token\b/.test(String(value)),
);
```

State in report copy that advertised capability does not prove enforcement. Do not flag `token_endpoint_auth_method=none` by itself. Set the artifact name to `oidc-discovery-configuration-review-{{date}}`.

- [ ] **Step 5: Run template and live-input tests**

Run:

```powershell
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun test scripts/__tests__/template-library-live-audit-utils.test.ts
bun --cwd=backend run typecheck
```

Expected: all commands exit 0.

### Task 2: Deterministic actionable report summaries

**Files:**

- Create: `frontend/src/components/timeline/runReportSummary.ts`
- Create: `frontend/src/components/timeline/RunReportSummary.tsx`
- Create: `frontend/src/components/timeline/__tests__/runReportSummary.test.ts`
- Create: `frontend/src/components/timeline/__tests__/RunReportSummary.test.tsx`
- Modify: `frontend/src/components/timeline/RunResultsSummary.tsx`

**Interfaces:**

- Consumes: `ArtifactMetadata`, `getArtifactPreviewEligibility()`, and `useArtifactPreview()`.
- Produces:

```ts
export interface RunReportMetric {
  label: string;
  value: string;
}

export interface ActionableRunReportSummary {
  metrics: RunReportMetric[];
  notice: string | null;
  nextSteps: string[];
}

export function selectReportArtifact(artifacts: ArtifactMetadata[]): ArtifactMetadata | undefined;

export function extractRunReportSummary(content: string): ActionableRunReportSummary | null;
```

- [ ] **Step 1: Add failing pure-helper tests**

Cover:

- report selection prefers `core.artifact.writer`, JSON MIME, previewable size, and report-like names;
- root, `report`, and `brief` envelopes;
- numeric zero and boolean false preservation;
- maximum four metrics and two actions;
- first warning/recommendation selection;
- malformed JSON returns `null`.

Example:

```ts
expect(
  extractRunReportSummary(
    JSON.stringify({
      summary: { packagesChecked: 3, vulnerablePackages: 0, highestSeverity: null },
      warnings: ['NVD lookup was unavailable'],
      nextSteps: ['Retry later', 'Review lockfile', 'Ignored third action'],
    }),
  ),
).toEqual({
  metrics: [
    { label: 'Packages checked', value: '3' },
    { label: 'Vulnerable packages', value: '0' },
  ],
  notice: 'NVD lookup was unavailable',
  nextSteps: ['Retry later', 'Review lockfile'],
});
```

- [ ] **Step 2: Implement pure selection and parsing**

Artifact selection score:

```ts
score += artifact.componentRef === 'core.artifact.writer' ? 100 : 0;
score += /application\/(?:[^;]+\+)?json/i.test(artifact.mimeType) ? 50 : 0;
score += /(report|brief|result|triage|finding)/i.test(artifact.name) ? 20 : 0;
```

Exclude anything not `previewable`. Parse content defensively. Use the root object, then prefer `root.report` or `root.brief` when either is an object. Humanize camelCase labels, omit null/object/array metrics, cap string metric values at 80 characters, and use top-level or envelope `warnings`, `recommendations`, and `nextSteps`.

- [ ] **Step 3: Add failing component tests**

Mock `useArtifactPreview`. Assert:

- loading copy is neutral;
- parsed metrics and next actions render as text;
- malformed/failed preview offers View full report without an error banner;
- clicking View full report invokes `onViewReport`.

- [ ] **Step 4: Implement `RunReportSummary`**

Use:

```tsx
export function RunReportSummary({
  runId,
  artifacts,
  onViewReport,
}: {
  runId: string;
  artifacts: ArtifactMetadata[];
  onViewReport: () => void;
}) {
  const artifact = useMemo(() => selectReportArtifact(artifacts), [artifacts]);
  const preview = useArtifactPreview(runId, artifact);
  const summary = useMemo(
    () => (preview.data?.status === 'ready' ? extractRunReportSummary(preview.data.content) : null),
    [preview.data],
  );
  // Render bounded metrics/actions or the neutral full-report fallback.
}
```

Use existing `Badge` and `Button` primitives. Do not use `dangerouslySetInnerHTML` or a Markdown renderer.

- [ ] **Step 5: Integrate with `RunResultsSummary`**

Remove the unused `Sparkles` import and replace only the placeholder block with:

```tsx
<RunReportSummary
  runId={runId}
  artifacts={artifacts ?? []}
  onViewReport={() => setInspectorTab('artifacts')}
/>
```

Do not change surrounding layout, node status, duration, or artifact controls.

- [ ] **Step 6: Run focused frontend tests and typecheck**

Run:

```powershell
bun --cwd=frontend test src/components/timeline/__tests__/runReportSummary.test.ts src/components/timeline/__tests__/RunReportSummary.test.tsx
bun --cwd=frontend run typecheck
```

Expected: all commands exit 0.

### Task 3: Recommendation fallback for fresh installs

**Files:**

- Modify: `frontend/src/pages/template-library/setupLevel.ts`
- Modify: `frontend/src/pages/template-library/__tests__/setupLevel.test.ts`

**Interfaces:**

- Consumes: `Template.validation`, `Template.isVerified`, and existing setup classification.
- Produces: `isRecommendedTemplate()` behavior that distinguishes absent evidence from stale evidence.

- [ ] **Step 1: Add failing recommendation tests**

Add:

```ts
it('recommends a reviewed official no-setup template when validation is unknown', () => {
  expect(
    isRecommendedTemplate({
      ...baseTemplate,
      isOfficial: true,
      isVerified: true,
      validation: {
        status: 'unknown',
        recommendation: 'unknown',
        rationale: 'No live validation ledger entry found for this template.',
        isCurrent: false,
      },
    }),
  ).toBe(true);
});

it('does not use reviewed status to override stale live evidence', () => {
  expect(
    isRecommendedTemplate({
      ...baseTemplate,
      isOfficial: true,
      isVerified: true,
      validation: {
        status: 'live-verified',
        recommendation: 'keep',
        rationale: 'Fingerprint is stale.',
        isCurrent: false,
      },
    }),
  ).toBe(false);
});
```

- [ ] **Step 2: Implement the minimal fallback**

Use:

```ts
const hasNoLiveEvidence = !template.validation || template.validation.status === 'unknown';
const hasTrustedValidation = template.validation
  ? isLiveVerifiedTemplate(template)
  : template.isVerified;
const hasReviewedFallback = hasNoLiveEvidence && template.isVerified;

return (
  getTemplateSetupLevel(template) === 'no-setup' &&
  template.isOfficial &&
  (hasTrustedValidation || hasReviewedFallback)
);
```

Do not change `isLiveVerifiedTemplate`; the Live verified badge must remain evidence-based.

- [ ] **Step 3: Run focused setup-level tests**

Run:

```powershell
bun --cwd=frontend test src/pages/template-library/__tests__/setupLevel.test.ts
```

Expected: all tests exit 0.

### Task 4: Integration and live validation

**Files:**

- Inspect all files changed by Tasks 1–3.
- Do not modify unrelated user-owned files.

**Interfaces:**

- Consumes: completed template, summary, and recommendation streams.
- Produces: seeded and live-verified local templates plus browser evidence.

- [ ] **Step 1: Confirm instance and runtime health**

Run:

```powershell
bun run instance show
bun run dev status
```

Expected: instance `0`; backend, worker, Postgres, Redis, Temporal, and MinIO healthy. Nginx is not required for the direct API audit.

- [ ] **Step 2: Seed safely**

Run:

```powershell
bun --cwd=backend scripts/seed-templates.ts --dry-run
bun --cwd=backend scripts/seed-templates.ts
```

Confirm the script prints the active target database before the write and reports both templates inserted or updated.

- [ ] **Step 3: Live-audit only the new templates**

Run:

```powershell
bun run template-library:audit -- --force --name "Domain Email Authentication Posture" --name "OIDC Discovery Configuration Review"
```

Expected: both workflows reach `COMPLETED`, produce at least one artifact, and receive recommendation `keep`.

- [ ] **Step 4: Run the bounded integration gate**

Run:

```powershell
bun run template-library:check
bun --cwd=frontend test src/components/timeline/__tests__/runReportSummary.test.ts src/components/timeline/__tests__/RunReportSummary.test.tsx src/pages/template-library/__tests__/setupLevel.test.ts
bun --cwd=backend test src/templates/__tests__/seed-templates.spec.ts
bun run typecheck
git diff --check
```

If `template-library:check` reports only the six known unrelated stale entries documented in the design, record that separately; new templates must be current.

- [ ] **Step 5: Manually verify one browser path**

Use instance 0 to configure and run Domain Email Authentication Posture with `example.com`. Confirm:

- Create & Run launches once;
- the run completes;
- the summary shows email posture metrics and at least one next action;
- View full report opens the JSON artifact;
- no manual refresh is required.

- [ ] **Step 6: Commit the implementation locally**

Stage only plan-owned files after checking `git status --short`. Commit with:

```powershell
git commit -s -m "feat: add actionable starter workflow reports"
```

Do not push until the user asks.
