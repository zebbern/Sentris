import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..', '..');

describe('production backend image migration runtime', () => {
  it('copies the shared local-script runtime used by the startup migration command', () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
    const backendStage = dockerfile.indexOf('FROM base AS backend');
    const runtimeCopy = dockerfile.indexOf(
      'COPY --chown=sentris:sentris scripts/lib/local-script-runtime.ts scripts/lib/local-script-runtime.ts',
    );

    expect(runtimeCopy).toBeGreaterThanOrEqual(0);
    expect(runtimeCopy).toBeLessThan(backendStage);
  });
});
