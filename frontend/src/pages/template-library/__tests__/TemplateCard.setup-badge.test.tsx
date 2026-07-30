import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { createDialogMock } from '@/test/mocks/dialog';
import type { Template } from '@/types/templates';

mock.module('@/components/ui/dialog', createDialogMock);

import { TemplateCard } from '../TemplateCard';
import { TemplateDetailModal } from '../TemplateDetailModal';

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

describe('TemplateCard readiness metadata', () => {
  it('keeps readiness status out of the grid card', () => {
    const t = makeTemplate([
      'core.workflow.entrypoint',
      'sentris.nvd.cve.query',
      'core.artifact.writer',
    ]);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse />);
    expect(screen.queryByText('No setup required')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText(/ago|today/i)).toBeNull();
  });

  it('surfaces readiness in the detail modal instead', () => {
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

    render(
      <TemplateDetailModal template={t} open onOpenChange={() => {}} onUse={() => {}} canUse />,
    );

    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Live verified')).toBeDefined();
    expect(screen.getByText('No setup required')).toBeDefined();
    expect(screen.getByText(/Updated /i)).toBeDefined();
    expect(screen.getByText('1 run input')).toBeDefined();
    expect(screen.getByText('Creates a report')).toBeDefined();
  });

  it('still shows recommended starter and CTA on the card', () => {
    const t = makeTemplate([
      'core.workflow.entrypoint',
      'sentris.osv.query',
      'core.artifact.writer',
    ]);
    render(<TemplateCard template={t} onUse={() => {}} onPreview={() => {}} canUse recommended />);

    expect(screen.getByText('Recommended starter')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Configure & Run' })).toBeDefined();
  });
});
