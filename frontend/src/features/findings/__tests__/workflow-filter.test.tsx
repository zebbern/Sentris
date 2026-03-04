import { describe, it, expect, afterEach, vi, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@/hooks/queries/useWorkflowQueries', () => ({
  useWorkflowsList: () => ({
    data: [
      { id: 'wf-1', name: 'Port Scanner' },
      { id: 'wf-2', name: 'Web Scan' },
      { id: 'wf-3', name: 'DNS Enum' },
    ],
  }),
}));

import { WorkflowFilter } from '../WorkflowFilter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = createTestQueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// WorkflowFilter
// ---------------------------------------------------------------------------

describe('WorkflowFilter', () => {
  it('renders select trigger', () => {
    render(<WorkflowFilter value={undefined} onChange={vi.fn()} />, { wrapper: Wrapper });

    // The "All workflows" text should appear in the trigger
    expect(screen.getByText('All workflows')).toBeTruthy();
  });

  it('displays "All workflows" as default option text', () => {
    render(<WorkflowFilter value={undefined} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('All workflows')).toBeTruthy();
  });

  it('shows selected workflow name when value is set', () => {
    render(<WorkflowFilter value="wf-1" onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('Port Scanner')).toBeTruthy();
  });
});
