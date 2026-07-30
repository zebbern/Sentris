import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ci = readFileSync(resolve(import.meta.dir, '../../.github/workflows/ci.yml'), 'utf8');
const release = readFileSync(
  resolve(import.meta.dir, '../../.github/workflows/release.yml'),
  'utf8',
);
const releaseDocs = readFileSync(
  resolve(import.meta.dir, '../../docs/development/release-process.mdx'),
  'utf8',
);
const rootPackage = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf8'),
) as { scripts: Record<string, string> };
const backendPackage = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../backend/package.json'), 'utf8'),
) as { scripts: Record<string, string> };

describe('release CI gate', () => {
  it('builds every shipped application before release smoke', () => {
    expect(ci).toContain('Build frontend');
    expect(ci).toContain('Build backend');
    expect(ci).toContain('Build worker');
  });

  it('runs the root release, Compose, performance, and documentation harness explicitly', () => {
    expect(ci).toContain('Run release harness tests');
    expect(ci).toContain('bun test scripts/__tests__');
    expect(ci).toContain('smoke:findings-opensearch:typecheck');
    expect(ci).toContain('smoke:telemetry-durability:typecheck');
  });

  it('typechecks release-critical backend scripts, E2E sources, and benchmark entrypoints', () => {
    expect(backendPackage.scripts['typecheck:scripts']).toBe('tsc -p tsconfig.scripts.json');
    expect(rootPackage.scripts['typecheck:e2e']).toBe('tsc -p tsconfig.e2e.json');
    expect(rootPackage.scripts['typecheck:release-scripts']).toBe(
      'tsc -p tsconfig.release-scripts.json',
    );
    expect(ci).toContain('bun --cwd=backend run typecheck:scripts');
    expect(ci).toContain('bun --cwd=backend run migration:typecheck');
    expect(ci).toContain('bun run typecheck:e2e');
    expect(ci).toContain('bun run typecheck:release-scripts');
    expect(ci).toContain('bun run smoke:telemetry-durability:typecheck');
  });

  it('proves fresh, upgrade, parity, and concurrent checked migrations against explicit databases', () => {
    expect(ci).toContain('migration:smoke:fresh');
    expect(ci).toContain('migration:smoke:upgrade');
    expect(ci).toContain('migration:smoke:parity');
    expect(ci).toContain('migration:smoke:concurrent');
    expect(ci).toContain('MIGRATION_SMOKE_DATABASE_URL');
  });

  it('regenerates and rejects drift in both OpenAPI and the shipped backend client', () => {
    expect(ci).toContain('bun --cwd=backend run generate:openapi');
    expect(ci).toContain('bun --cwd=packages/backend-client run generate');
    expect(ci).toContain('bun --cwd=packages/backend-client run typecheck');
    expect(ci).toContain('packages/backend-client/src/client.ts');
  });

  it('runs the destructive production topology smoke only with an explicit instance', () => {
    expect(ci).toContain('smoke:production-compose');
    expect(ci).toContain("SENTRIS_INSTANCE: '0'");
    expect(ci).toContain('CI: true');
  });

  it('runs the production topology smoke under both supported trust profiles', () => {
    expect(ci).toMatch(
      /production-smoke:[\s\S]*matrix:[\s\S]*trust-profile:\s*\[trusted-local,\s*hardened\]/,
    );
    expect(ci).toContain('SENTRIS_TRUST_PROFILE: ${{ matrix.trust-profile }}');
    expect(ci).toMatch(/production-smoke:[\s\S]*timeout-minutes:\s*180/);
  });

  it('installs Chromium only for the trusted-local real-browser release leg', () => {
    expect(ci).toContain('Install Chromium for trusted-local browser journey');
    expect(ci).toContain("if: matrix.trust-profile == 'trusted-local'");
    expect(ci).toContain('bunx playwright install --with-deps chromium');
    expect(ci).not.toContain('playwright install chromium@');
  });

  it('runs the focused cross-tenant negative suite as a named release dependency', () => {
    expect(ci).toContain('tenant-boundaries:');
    expect(ci).toContain('api-keys.http.spec.ts');
    expect(ci).toContain('integrations.http.spec.ts');
    expect(ci).toContain('secrets.adapter.test.ts');
  });

  it('keeps the production smoke behind static, unit, contract, and migration gates', () => {
    expect(ci).toMatch(
      /production-smoke:[\s\S]*needs:\s*\[[^\]]*lint[^\]]*typecheck[^\]]*test-unit[^\]]*tenant-boundaries[^\]]*build[^\]]*api-contract[^\]]*migration-smoke[^\]]*\]/,
    );
  });

  it('enforces a same-host exact-revision performance pair for reusable release calls', () => {
    expect(ci).toMatch(
      /workflow_call:[\s\S]*inputs:[\s\S]*performance_baseline_revision:[\s\S]*type:\s*string/,
    );
    expect(ci).toMatch(
      /performance-pair:[\s\S]*if:\s*\$\{\{\s*inputs\.performance_baseline_revision != ''\s*\}\}/,
    );
    expect(ci).toMatch(/performance-pair:[\s\S]*timeout-minutes:\s*210/);
    expect(ci).toContain('git worktree add --detach');
    expect(ci).toContain('bun run performance:pair --');
    expect(ci).toContain('--baseline-root "$RUNNER_TEMP/sentris-baseline"');
    expect(ci).toContain('--candidate-root "$GITHUB_WORKSPACE"');
    expect(ci).toContain('--output-dir "$RUNNER_TEMP/sentris-performance-pair"');
    expect(ci).toContain('RELEASE_BENCHMARK_ADMIN_PASSWORD');
    expect(ci).toContain('RELEASE_BENCHMARK_INTERNAL_TOKEN');
    expect(ci).toMatch(
      /performance-pair:[\s\S]*uses:\s*actions\/upload-artifact@v4[\s\S]*if:\s*always\(\)/,
    );
  });

  it('resolves a distinct ancestor baseline before invoking release readiness', () => {
    expect(release).toContain('performance_baseline_ref:');
    expect(release).toMatch(
      /resolve-performance-baseline:[\s\S]*git describe --tags[\s\S]*git merge-base --is-ancestor/,
    );
    expect(release).toMatch(
      /readiness:[\s\S]*needs:\s*resolve-performance-baseline[\s\S]*performance_baseline_revision:\s*\$\{\{\s*needs\.resolve-performance-baseline\.outputs\.baseline_revision\s*\}\}/,
    );
  });

  it('validates manual release metadata without shell interpolation and keeps automation DCO-safe', () => {
    expect(release).toContain('MANUAL_VERSION: ${{ github.event.inputs.version }}');
    expect(release).not.toContain('VERSION="${{ github.event.inputs.version }}"');
    expect(release).toContain('Invalid release version');
    expect(release).toContain('--target "$GITHUB_SHA"');
    expect(release).not.toContain('git push origin --delete "chore/bump-version-${VERSION_CLEAN}"');
    expect(release).toContain(
      'git commit -s -m "chore: bump version to ${VERSION_CLEAN} [skip ci]"',
    );
  });

  it('blocks image and GitHub release publication on the reusable readiness gate', () => {
    expect(ci).toContain('workflow_call:');
    expect(release).toMatch(
      /readiness:[\s\S]*uses:\s*\.\/\.github\/workflows\/ci\.yml[\s\S]*build-and-push:[\s\S]*needs:\s*readiness/,
    );
  });

  it('documents that both tag and manual publication wait for the full readiness workflow', () => {
    expect(releaseDocs).toContain('full readiness gate');
    expect(releaseDocs).toContain('does not publish');
  });

  it('documents the browser gate and the separate real-Clerk operator proof', () => {
    expect(releaseDocs).toContain('real-browser target journey');
    expect(releaseDocs).toMatch(/real local-admin\s+login/);
    expect(releaseDocs).toContain('real Clerk');
    expect(releaseDocs).toContain('Playwright');
  });

  it('documents the trusted-local findings outage and live OpenSearch acceptance gate', () => {
    expect(releaseDocs).toContain('Findings/OpenSearch release proof');
    expect(releaseDocs).toContain('HTTP 503');
    expect(releaseDocs).toContain('more than 10,000');
    expect(releaseDocs).toContain('125-second');
    expect(releaseDocs).toMatch(/10,420\s+seconds/);
    expect(releaseDocs).toMatch(/5,800\s+seconds/);
    expect(releaseDocs).toMatch(/180\s+minutes/);
  });

  it('documents the enforced performance pair and bounded two-stream telemetry restart proof', () => {
    expect(releaseDocs).toContain('Performance release gate');
    expect(releaseDocs).toContain('full 40-character commit');
    expect(releaseDocs).toContain('fixed 10%');
    expect(releaseDocs).toContain('Telemetry durability release proof');
    expect(releaseDocs).toContain('events and logs');
    expect(releaseDocs).toContain('agent-trace and node-I/O');
    expect(releaseDocs).toContain('down -v --remove-orphans');
  });
});
