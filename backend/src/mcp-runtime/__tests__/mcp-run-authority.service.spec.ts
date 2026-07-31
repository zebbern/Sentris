import { describe, expect, it, vi } from 'bun:test';
import type { StoredMcpAuthority } from '../mcp-runtime.repository';
import { McpRunAuthorityService } from '../mcp-run-authority.service';

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

describe('McpRunAuthorityService', () => {
  it('reuses one semantic authority for repeated and concurrent identical requests', async () => {
    let configFingerprint = FINGERPRINT_A;
    const stored = new Map<string, StoredMcpAuthority>();
    const candidates: StoredMcpAuthority[] = [];
    const createOrReadRunAuthority = vi.fn(
      async (input: {
        authorityKey: string;
        grant: StoredMcpAuthority['grant'];
        snapshot: StoredMcpAuthority['snapshot'];
        manifest: StoredMcpAuthority['manifest'];
      }) => {
        const candidate = {
          grant: input.grant,
          snapshot: input.snapshot,
          manifest: input.manifest,
        };
        candidates.push(candidate);
        const existing = stored.get(input.authorityKey);
        if (existing) return existing;
        stored.set(input.authorityKey, candidate);
        return candidate;
      },
    );
    const service = new McpRunAuthorityService(
      {
        build: vi.fn(async () => ({
          tools: [componentTool(configFingerprint)],
          configFingerprint,
        })),
      } as never,
      { createOrReadRunAuthority } as never,
    );
    const input = {
      runId: 'run-1',
      organizationId: 'org-1',
      invokingNodeId: 'agent-node',
      allowedNodeIds: [' tool-b ', 'tool-a', 'tool-b'],
    };

    const first = await service.materialize(input);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const repeated = await service.materialize(input);
    const [concurrentOne, concurrentTwo] = await Promise.all([
      service.materialize({ ...input, allowedNodeIds: ['tool-a', 'tool-b'] }),
      service.materialize({ ...input, allowedNodeIds: ['tool-b', 'tool-a'] }),
    ]);

    expect(repeated).toBe(first);
    expect(concurrentOne).toBe(first);
    expect(concurrentTwo).toBe(first);
    expect(candidates[0].grant.createdAt).not.toBe(candidates[1].grant.createdAt);
    expect(new Set(candidates.map((candidate) => candidate.grant.id)).size).toBe(1);
    expect(first.snapshot.scope).toEqual({
      kind: 'run',
      runId: 'run-1',
      organizationId: 'org-1',
      capabilityGrantId: first.grant.id,
      invokingNodeId: 'agent-node',
    });
    expect(first.grant.sources).toEqual([
      { sourceId: 'component-node', toolAccess: { mode: 'all' } },
    ]);
    expect(first.manifest.entries).toEqual([
      {
        toolName: 'scan_target',
        sourceId: 'component-node',
        destination: 'component-activity',
        retryPolicy: 'pre-dispatch-only',
      },
    ]);

    configFingerprint = FINGERPRINT_B;
    const changed = await service.materialize(input);
    expect(changed.grant.id).not.toBe(first.grant.id);
    expect(changed.snapshot.id).not.toBe(first.snapshot.id);
    expect(stored.size).toBe(2);
  });
});

function componentTool(bindingFingerprint: string) {
  return {
    canonicalName: 'scan_target',
    displayName: 'Scan target',
    inputSchema: { type: 'object', additionalProperties: false },
    source: {
      kind: 'component' as const,
      sourceId: 'component-node',
      nodeId: 'component-node',
      componentId: 'security.scan-target',
      bindingFingerprint,
    },
    effects: 'unknown' as const,
    effectsSource: 'sentris-contract' as const,
    retryPolicy: 'pre-dispatch-only' as const,
  };
}
