import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { Template } from '@/types/templates';
import { TemplateCard } from '../TemplateCard';

afterEach(cleanup);

function makeTemplate(
  nodeTypes: string[],
  requiredSecrets: Template['requiredSecrets'] = [],
): Template {
  return {
    id: 't1',
    name: 'demo template',
    tags: [],
    repository: 'r',
    path: 'p',
    branch: 'main',
    manifest: {},
    graph: { nodes: nodeTypes.map((type, i) => ({ id: `n${i}`, type })) },
    requiredSecrets,
    popularity: 0,
    isOfficial: false,
    isVerified: false,
    isActive: true,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

describe('TemplateCard no-setup badge', () => {
  it('shows the badge for a net-only template', () => {
    const t = makeTemplate([
      'core.workflow.entrypoint',
      'sentris.nvd.cve.query',
      'core.artifact.writer',
    ]);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse />);
    expect(screen.getByText('No setup required')).toBeDefined();
  });

  it('does not show the badge for a Docker-scanner template', () => {
    const t = makeTemplate(['core.workflow.entrypoint', 'sentris.nuclei.scan']);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse />);
    expect(screen.queryByText('No setup required')).toBeNull();
  });
});
