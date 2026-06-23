import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const root = process.cwd();

describe('backend client smoke script', () => {
  it('exercises workflow update with the current workflow graph schema', () => {
    const source = readFileSync(join(root, 'packages', 'backend-client', 'test-client.ts'), 'utf8');

    expect(source).not.toContain('Skipping update workflow test');
    expect(source).not.toContain('known validation issue');
    expect(source).toContain("'x-internal-token': process.env.SENTRIS_INTERNAL_TOKEN ?? 'local-internal-token'");
    expect(source).toContain("'x-organization-id': process.env.SENTRIS_ORG_ID ?? 'local-dev'");
    expect(source).toContain('formatClientError');
    expect(source).toContain('client.updateWorkflow(');
    expect(source).toContain("type: 'core.workflow.entrypoint'");
    expect(source).toContain("type: 'core.logic.script'");
    expect(source).not.toContain("type: 'trigger'");
  });
});
