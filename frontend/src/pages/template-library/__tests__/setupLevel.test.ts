import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTemplateSetupLevel, isNoSetupTemplate } from '../setupLevel';

// Repo root's backend/scripts/seed-templates/, resolved relative to this test file
// (frontend/src/pages/template-library/__tests__/).
const SEED_TEMPLATES_DIR = join(import.meta.dir, '../../../../../backend/scripts/seed-templates');

function loadSeedNodeTypes(fileName: string): string[] {
  const raw = readFileSync(join(SEED_TEMPLATES_DIR, fileName), 'utf-8');
  const parsed = JSON.parse(raw) as { graph?: { nodes?: { type?: string }[] } };
  return (parsed.graph?.nodes ?? []).map((n) => n.type).filter((t): t is string => !!t);
}

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

  describe('allowlist drift guard (real seed templates)', () => {
    // Guards against NET_ONLY_COMPONENT_TYPES drifting out of sync with the
    // actual seed templates: this must fail if someone removes a
    // currently-allowlisted net-only type that these seeds rely on.
    it('classifies kev-fresh-cve-watch-brief.json as no-setup', () => {
      const nodeTypes = loadSeedNodeTypes('kev-fresh-cve-watch-brief.json');
      expect(getTemplateSetupLevel(tpl(nodeTypes))).toBe('no-setup');
    });

    it('classifies npm-dependency-cve-hunt.json as no-setup', () => {
      const nodeTypes = loadSeedNodeTypes('npm-dependency-cve-hunt.json');
      expect(getTemplateSetupLevel(tpl(nodeTypes))).toBe('no-setup');
    });

    it('classifies subdomain-takeover-triage.json as needs-tooling', () => {
      const nodeTypes = loadSeedNodeTypes('subdomain-takeover-triage.json');
      expect(getTemplateSetupLevel(tpl(nodeTypes))).toBe('needs-tooling');
    });
  });
});
