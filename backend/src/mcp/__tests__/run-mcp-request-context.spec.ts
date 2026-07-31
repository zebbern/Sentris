import { describe, expect, it } from 'bun:test';

import { parseRunMcpRequestContext, toRunExecutionScope } from '../run-mcp-request-context';

const GRANT_ID = '97d45255-a20d-4f3b-82c7-0e464f57632b';

describe('RunMcpRequestContext', () => {
  it('returns only a frozen token-bound scope with normalized node IDs', () => {
    const context = parseRunMcpRequestContext({
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: GRANT_ID,
      allowedNodeIds: [' node-b ', '', 'node-a', 'node-b', '   '],
      'x-allowed-tools': 'caller-controlled-tool',
    });

    expect(context).toEqual({
      kind: 'run',
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: GRANT_ID,
      allowedNodeIds: ['node-a', 'node-b'],
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.allowedNodeIds)).toBe(true);
    expect(() => (context.allowedNodeIds as string[]).push('widened-node')).toThrow();
  });

  it('preserves a null local organization in the shared execution scope', () => {
    const context = parseRunMcpRequestContext({
      runId: 'local-run',
      organizationId: null,
      capabilityGrantId: GRANT_ID,
    });

    expect(toRunExecutionScope(context)).toEqual({
      kind: 'run',
      runId: 'local-run',
      organizationId: null,
      capabilityGrantId: GRANT_ID,
    });
  });

  it.each([
    ['missing extra', undefined],
    ['missing run ID', { organizationId: null, capabilityGrantId: GRANT_ID }],
    ['empty run ID', { runId: ' ', organizationId: null, capabilityGrantId: GRANT_ID }],
    ['invalid organization', { runId: 'run-1', organizationId: 123, capabilityGrantId: GRANT_ID }],
    ['empty organization', { runId: 'run-1', organizationId: '', capabilityGrantId: GRANT_ID }],
    ['invalid grant ID', { runId: 'run-1', organizationId: null, capabilityGrantId: 'not-a-uuid' }],
    [
      'non-string node ID',
      {
        runId: 'run-1',
        organizationId: null,
        capabilityGrantId: GRANT_ID,
        allowedNodeIds: ['node-a', 123],
      },
    ],
  ])('rejects malformed token context: %s', (_description, extra) => {
    expect(() => parseRunMcpRequestContext(extra)).toThrow(
      'Invalid MCP run authentication context',
    );
  });
});
