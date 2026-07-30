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
    expect(screen.getByText('Local tools required')).toBeDefined();
  });

  it('surfaces live verification, run inputs, report output, and an action-oriented CTA', () => {
    const t = makeTemplate([
      'core.workflow.entrypoint',
      'sentris.osv.query',
      'core.artifact.writer',
    ]);
    t.graph = {
      nodes: [
        {
          id: 'entry',
          type: 'core.workflow.entrypoint',
          data: {
            config: {
              params: {
                runtimeInputs: [{ id: 'packageSpecs' }],
              },
            },
          },
        },
        { id: 'osv', type: 'sentris.osv.query' },
        { id: 'report', type: 'core.artifact.writer' },
      ],
    };
    t.validation = {
      status: 'live-verified',
      recommendation: 'keep',
      rationale: 'Passed a live run.',
      isCurrent: true,
    };

    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse recommended />);

    expect(screen.getByText('Recommended starter')).toBeDefined();
    expect(screen.getByText('Live verified')).toBeDefined();
    expect(screen.getByText('1 run input')).toBeDefined();
    expect(screen.getByText('Creates a report')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Configure & Run' })).toBeDefined();
  });
});
