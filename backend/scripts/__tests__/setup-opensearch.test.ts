import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';

const backendRoot = resolve(import.meta.dir, '..', '..');

describe('setup-opensearch script', () => {
  it('uses the OpenSearch client DynamicMapping string literal for object mappings', () => {
    const source = readFileSync(join(backendRoot, 'scripts', 'setup-opensearch.ts'), 'utf8');

    expect(source).toContain("dynamic: 'true'");
    expect(source).not.toContain('dynamic: true');
  });
});
