import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ArtifactMetadata } from '@sentris/shared';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';

const previewState: {
  data?: { status: 'ready'; content: string } | { status: 'too-large' };
  isLoading: boolean;
  error: Error | null;
} = {
  data: undefined,
  isLoading: false,
  error: null,
};

mock.module('@/hooks/queries/useArtifactQueries', () => ({
  ...realModuleExports('@/hooks/queries/useArtifactQueries'),
  useArtifactPreview: () => previewState,
}));

const { RunReportSummary } = await import('../RunReportSummary');

const reportArtifact: ArtifactMetadata = {
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'run-1',
  workflowId: 'workflow-1',
  workflowVersionId: null,
  componentRef: 'core.artifact.writer',
  fileId: '22222222-2222-4222-8222-222222222222',
  name: 'security-report.json',
  mimeType: 'application/json',
  size: 128,
  destinations: ['run'],
  createdAt: '2026-07-30T12:00:00.000Z',
};

describe('RunReportSummary', () => {
  afterEach(() => {
    cleanup();
    previewState.data = undefined;
    previewState.isLoading = false;
    previewState.error = null;
  });

  afterAll(() => {
    restoreMockedModules(['@/hooks/queries/useArtifactQueries']);
  });

  it('uses neutral copy while the report preview is loading', () => {
    previewState.isLoading = true;

    render(<RunReportSummary runId="run-1" artifacts={[reportArtifact]} onViewReport={() => {}} />);

    expect(screen.getByText('Preparing report summary…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders parsed metrics and next actions as plain text', () => {
    previewState.data = {
      status: 'ready',
      content: JSON.stringify({
        summary: { findings: 2, remediationRequired: false },
        nextSteps: ['Review findings', 'Create a ticket'],
      }),
    };

    render(<RunReportSummary runId="run-1" artifacts={[reportArtifact]} onViewReport={() => {}} />);

    expect(screen.getByText('Findings: 2')).toBeTruthy();
    expect(screen.getByText('Remediation required: false')).toBeTruthy();
    expect(screen.getByText('Review findings')).toBeTruthy();
    expect(screen.getByText('Create a ticket')).toBeTruthy();
  });

  it('offers the full report without an error banner when preview content cannot be summarized', () => {
    previewState.data = { status: 'ready', content: '{not json' };
    previewState.error = new Error('Preview request failed');

    render(<RunReportSummary runId="run-1" artifacts={[reportArtifact]} onViewReport={() => {}} />);

    expect(screen.getByRole('button', { name: 'View full report' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Preview request failed')).toBeNull();
  });

  it('opens the artifacts inspector from the full report action', () => {
    const onViewReport = mock(() => {});

    render(
      <RunReportSummary runId="run-1" artifacts={[reportArtifact]} onViewReport={onViewReport} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View full report' }));

    expect(onViewReport).toHaveBeenCalledTimes(1);
  });
});
