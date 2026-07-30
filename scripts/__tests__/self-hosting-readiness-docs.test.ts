import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function listActiveOperatorDocs(relativeDirectory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, relativeDirectory), { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (relativePath === 'docs/superpowers/plans') continue;
    if (entry.isDirectory()) {
      files.push(...listActiveOperatorDocs(relativePath));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      files.push(relativePath);
    }
  }
  return files;
}

describe('self-hosting release documentation', () => {
  const guide = read('docs/self-hosting.mdx');
  const compose = read('docker/docker-compose.full.yml');
  const docsNavigation = read('docs/docs.json');
  const packageJson = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>;
  };

  it('covers every required operator decision and recovery procedure', () => {
    for (const heading of [
      '## Choose the trust profile',
      '## Required configuration',
      '## Start and verify',
      '## Capability and egress controls',
      '### Capability regression matrix',
      '## Checked upgrades',
      '### Rollback',
      '## Recover durable side effects',
      '## Backup and restore',
      '## Performance gate',
      '## Accepted residual risks',
    ]) {
      expect(guide, `missing self-hosting section: ${heading}`).toContain(heading);
    }

    expect(docsNavigation).toContain('"self-hosting"');
    expect(guide).toContain('/api/v1/admin/outbox/dead-letters');
    expect(guide).toContain('/api/v1/ticketing/reconciliation/');
    expect(guide).toContain('Do not generically requeue an ambiguous external side effect');
  });

  it('keeps documented production variables and release commands wired to code', () => {
    for (const variable of [
      'SENTRIS_TRUST_PROFILE',
      'INTERNAL_SERVICE_TOKEN',
      'INTEGRATION_STORE_MASTER_KEY',
      'MCP_DISCOVERY_TRUSTED_LOCAL_STDIO',
      'MCP_DOCKER_PROXY_TOKEN',
      'SENTRIS_PUBLIC_API_BASE_URL',
    ]) {
      expect(guide, `${variable} must be documented`).toContain(variable);
      expect(compose, `${variable} must be wired into production Compose`).toContain(variable);
    }

    for (const script of [
      'smoke:production-compose',
      'smoke:browser-target-journey',
      'smoke:findings-opensearch',
      'performance:collect',
      'performance:compare',
      'test:e2e:release',
    ]) {
      expect(packageJson.scripts?.[script], `missing package script: ${script}`).toBeString();
      expect(guide, `${script} must have an operator-facing command`).toContain(script);
    }
  });

  it('uses Bun cwd syntax that executes on the pinned cross-platform runtime', () => {
    const operatorFiles = [
      'AGENTS.md',
      'package.json',
      ...listActiveOperatorDocs('docs'),
      ...listActiveOperatorDocs('frontend/docs'),
    ];

    for (const relativePath of operatorFiles) {
      expect(read(relativePath), `${relativePath} uses the false-green Bun cwd form`).not.toMatch(
        /\bbun --cwd\s+/,
      );
    }
  });

  it('records accepted decisions for every shipped release boundary', () => {
    const adrs = [
      'docs/architecture/adr-self-hosted-trust-profiles.md',
      'docs/architecture/adr-worker-capability-and-credential-boundaries.md',
      'docs/architecture/adr-findings-ownership-and-projection.md',
      'docs/architecture/adr-supported-docker-dind-topology.md',
    ];

    for (const adrPath of adrs) {
      const adr = read(adrPath);
      expect(adr, `${adrPath} must be accepted before release`).toContain('**Accepted');
      expect(adr).toContain('## Consequences');
      expect(adr).toContain('## Alternatives Considered');
    }
  });

  it('states the trusted-worker residual risk without claiming an unshipped token design', () => {
    const workerAdr = read('docs/architecture/adr-worker-capability-and-credential-boundaries.md');

    expect(workerAdr).toContain('trusted computing base');
    expect(workerAdr).toContain('never copied into a component container');
    expect(workerAdr).not.toContain('Backend callbacks use a short-lived');
    expect(guide).toContain('The worker is part of the trusted computing base');
  });
});
