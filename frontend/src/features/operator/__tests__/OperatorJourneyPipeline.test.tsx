import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@/test/render-with-providers';

import { OperatorJourneyPipeline } from '../OperatorJourneyPipeline';
import type { ProjectedOperatorJourneyPipeline } from '../operatorJourneyPipelineProjector';

afterEach(cleanup);

const pipeline: ProjectedOperatorJourneyPipeline = {
  turnId: '22222222-2222-4222-8222-222222222222',
  turnStatus: 'awaiting_approval',
  sourceRunId: 'sentris-run-source',
  candidateRunId: 'sentris-run-candidate',
  stages: [
    { id: 'inspect', label: 'Inspect', state: 'completed', detail: 'Source inspected' },
    { id: 'draft', label: 'Draft', state: 'completed', detail: 'Revision drafted' },
    { id: 'save', label: 'Save', state: 'attention', detail: 'Approval required' },
    { id: 'run', label: 'Run', state: 'pending', detail: 'Candidate run' },
    { id: 'compare', label: 'Compare', state: 'pending', detail: 'Compare evidence' },
    { id: 'decision', label: 'Decide', state: 'pending', detail: 'Keep or revise' },
  ],
};

describe('OperatorJourneyPipeline', () => {
  it('renders the durable stage states and real run links compactly', () => {
    renderWithProviders(<OperatorJourneyPipeline pipeline={pipeline} />, {
      initialEntries: ['/operator/session-1'],
    });

    expect(screen.getByRole('region', { name: 'Improvement pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Approval required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source run' })).toHaveAttribute(
      'href',
      '/runs/sentris-run-source',
    );
    expect(screen.getByRole('link', { name: 'Candidate run' })).toHaveAttribute(
      'href',
      '/runs/sentris-run-candidate',
    );
  });
});
