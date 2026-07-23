import { describe, it, expect } from 'bun:test';
import { getTemplateSetupLevel, isNoSetupTemplate } from '../setupLevel';

// Minimal template shape the helper reads.
function tpl(nodeTypes: string[], requiredSecrets: { name: string; type: string }[] = []) {
  return {
    graph: { nodes: nodeTypes.map((type, i) => ({ id: `n${i}`, type })) },
    requiredSecrets,
  };
}

describe('getTemplateSetupLevel', () => {
  it('classifies a net-only template as no-setup', () => {
    // Mirrors kev-fresh-cve-watch-brief / npm-dependency-cve-hunt component sets.
    const t = tpl([
      'core.workflow.entrypoint',
      'sentris.nvd.cve.query',
      'core.http.request',
      'core.logic.script',
      'core.artifact.writer',
    ]);
    expect(getTemplateSetupLevel(t)).toBe('no-setup');
    expect(isNoSetupTemplate(t)).toBe(true);
  });

  it('classifies a template with a Docker scanner as needs-tooling', () => {
    // Mirrors subdomain-takeover-triage.
    const t = tpl([
      'core.workflow.entrypoint',
      'sentris.subfinder.run',
      'sentris.nuclei.scan',
      'core.artifact.writer',
    ]);
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
    expect(isNoSetupTemplate(t)).toBe(false);
  });

  it('classifies a template requiring secrets as needs-secrets even if all nodes are net-only', () => {
    const t = tpl(
      ['core.workflow.entrypoint', 'core.http.request'],
      [{ name: 'API_KEY', type: 'api_key' }],
    );
    expect(getTemplateSetupLevel(t)).toBe('needs-secrets');
    expect(isNoSetupTemplate(t)).toBe(false);
  });

  it('treats an unknown component type as needs-tooling (allowlist, not denylist)', () => {
    const t = tpl(['core.workflow.entrypoint', 'sentris.some.future.scanner']);
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
  });

  it('handles a missing/empty graph as needs-tooling (cannot prove it is net-only)', () => {
    expect(getTemplateSetupLevel({ graph: undefined, requiredSecrets: [] })).toBe('needs-tooling');
    expect(getTemplateSetupLevel({ graph: { nodes: [] }, requiredSecrets: [] })).toBe(
      'needs-tooling',
    );
  });

  it('ignores nodes with no type by treating them as non-net-only (safe default)', () => {
    const t = tpl(['core.workflow.entrypoint', 'core.http.request']);
    // add a typeless node
    (t.graph.nodes as { id: string; type?: string }[]).push({ id: 'x' });
    expect(getTemplateSetupLevel(t)).toBe('needs-tooling');
  });
});
