import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('terminal archive routing', () => {
  it('does not let status polling compete with durable terminal lifecycle delivery', () => {
    const controller = source('../workflow-runs.controller.ts');

    expect(controller).not.toContain('terminalArchiveService.archiveRun');
  });

  it('does not let SSE polling compete with durable terminal lifecycle delivery', () => {
    const controller = source('../workflow-run-stream.controller.ts');

    expect(controller).not.toContain('terminalArchiveService.archiveRun');
  });
});
