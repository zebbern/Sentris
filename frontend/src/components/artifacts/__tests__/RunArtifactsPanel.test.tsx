import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ArtifactMetadata } from '@sentris/shared';
import { renderWithProviders } from '@/test/render-with-providers';
import { realModuleExports, restoreMockedModules } from '@/test/restore-mocks';

const artifacts: ArtifactMetadata[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    runId: 'run-1',
    workflowId: 'workflow-1',
    workflowVersionId: null,
    componentRef: 'core.artifact.writer',
    fileId: '22222222-2222-4222-8222-222222222222',
    name: 'results.json',
    mimeType: 'application/json',
    size: 42,
    destinations: ['run'],
    createdAt: '2026-07-30T12:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    runId: 'run-1',
    workflowId: 'workflow-1',
    workflowVersionId: null,
    componentRef: 'core.artifact.writer',
    fileId: '44444444-4444-4444-8444-444444444444',
    name: 'full-report.pdf',
    mimeType: 'application/pdf',
    size: 10_000,
    destinations: ['run'],
    createdAt: '2026-07-30T12:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    runId: 'run-1',
    workflowId: 'workflow-1',
    workflowVersionId: null,
    componentRef: 'core.artifact.writer',
    fileId: '66666666-6666-4666-8666-666666666666',
    name: 'large-output.txt',
    mimeType: 'text/plain',
    size: 400_000,
    destinations: ['run'],
    createdAt: '2026-07-30T12:00:00.000Z',
  },
];

const previewState: {
  data?: { status: 'ready'; content: string } | { status: 'too-large' };
  isLoading: boolean;
  error: Error | null;
} = {
  data: {
    status: 'ready',
    content: '{\n  "severity": "high",\n  "finding": "Prototype pollution"\n}',
  },
  isLoading: false,
  error: null,
};

const downloadMutate = mock(() => {});
const previewRefetch = mock(() => Promise.resolve());

mock.module('@/hooks/queries/useArtifactQueries', () => ({
  ...realModuleExports('@/hooks/queries/useArtifactQueries'),
  useRunArtifacts: () => ({
    data: artifacts,
    isLoading: false,
    error: null,
  }),
  useArtifactPreview: () => ({
    data: previewState.data,
    isLoading: previewState.isLoading,
    error: previewState.error,
    refetch: previewRefetch,
  }),
  useDownloadArtifact: () => ({
    mutate: downloadMutate,
    isPending: false,
    variables: undefined,
  }),
}));

mock.module('@/hooks/useCopyToClipboard', () => ({
  ...realModuleExports('@/hooks/useCopyToClipboard'),
  useCopyToClipboard: () => ({
    copy: mock(() => Promise.resolve()),
    isCopied: () => false,
  }),
}));

import { RunArtifactsPanel } from '../RunArtifactsPanel';

describe('RunArtifactsPanel', () => {
  beforeEach(() => {
    cleanup();
    previewState.data = {
      status: 'ready',
      content: '{\n  "severity": "high",\n  "finding": "Prototype pollution"\n}',
    };
    previewState.isLoading = false;
    previewState.error = null;
    downloadMutate.mockClear();
    previewRefetch.mockClear();
  });

  afterEach(cleanup);

  afterAll(() => {
    restoreMockedModules(['@/hooks/queries/useArtifactQueries', '@/hooks/useCopyToClipboard']);
  });

  it('shows the first safe result inline by default and keeps markup inert', () => {
    renderWithProviders(<RunArtifactsPanel runId="run-1" />);

    const preview = screen.getByRole('region', { name: 'Preview of results.json' });
    expect(preview).toHaveTextContent('"severity": "high"');
    expect(preview).toHaveTextContent('"finding": "Prototype pollution"');
    expect(preview.querySelector('script')).toBeNull();
  });

  it('gives unsupported and oversized artifacts a clear download-only state', () => {
    renderWithProviders(<RunArtifactsPanel runId="run-1" />);

    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.getByText('Too large to preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download full-report.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download large-output.txt' })).toBeInTheDocument();
  });

  it('announces preview loading and lets the user retry a failed preview', () => {
    previewState.data = undefined;
    previewState.isLoading = true;
    const { rerender } = renderWithProviders(<RunArtifactsPanel runId="run-1" />);

    expect(screen.getByRole('region', { name: 'Preview of results.json' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('Loading preview…')).toBeInTheDocument();

    previewState.isLoading = false;
    previewState.error = new Error('Preview could not be loaded');
    rerender(<RunArtifactsPanel runId="run-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Preview could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(previewRefetch).toHaveBeenCalledTimes(1);
  });
});
