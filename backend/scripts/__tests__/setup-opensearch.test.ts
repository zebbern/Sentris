import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';

const backendRoot = resolve(import.meta.dir, '..', '..');

describe('setup-opensearch script', () => {
  it('installs the checked versioned findings template instead of an inline mapping copy', () => {
    const source = readFileSync(join(backendRoot, 'scripts', 'setup-opensearch.ts'), 'utf8');

    expect(source).toContain('buildFindingsIndexTemplate');
    expect(source).toContain('buildFindingsFinalIngestPipeline');
    expect(source).toContain('buildAllFindingObservationIndexPattern');
    expect(source).not.toContain("buildFindingsIndexTemplate(['security-findings-*'])");
    expect(source.indexOf('client.ingest.putPipeline')).toBeLessThan(
      source.indexOf('client.indices.putIndexTemplate'),
    );
    expect(source).toContain("from '../src/analytics/findings-index-template'");
    expect(source).not.toContain("severity: { type: 'keyword' }");
  });
});
