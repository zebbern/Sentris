import { describe, it, expect, afterEach, vi, mock } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@/hooks/queries/useComponentQueries', () => ({
  useComponents: () => ({
    data: {
      byId: {
        'comp-1': { id: 'comp-1', slug: 'nuclei', category: 'security' },
        'comp-2': { id: 'comp-2', slug: 'subfinder', category: 'security' },
        'comp-3': { id: 'comp-3', slug: 'httpx', category: 'security' },
        'comp-4': { id: 'comp-4', slug: 'slack-notify', category: 'notification' },
        'comp-5': { id: 'comp-5', slug: 'ai-summarize', category: 'ai' },
      },
    },
  }),
}));

import { ToolFilter } from '../ToolFilter';

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
// ToolFilter
// ---------------------------------------------------------------------------

describe('ToolFilter', () => {
  it('renders select trigger', () => {
    render(<ToolFilter value={undefined} onChange={vi.fn()} />, { wrapper: Wrapper });

    expect(screen.getByText('All tools')).toBeTruthy();
  });

  it('displays "All tools" as default option text', () => {
    render(<ToolFilter value={undefined} onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('All tools')).toBeTruthy();
  });

  it('shows selected component name when value is set to a security tool', () => {
    render(<ToolFilter value="comp-1" onChange={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.getByText('nuclei')).toBeTruthy();
  });

  it('does not display non-security tools when selected as value', () => {
    // comp-4 is notification category — it should not be a valid selectable value
    render(<ToolFilter value="comp-4" onChange={vi.fn()} />, { wrapper: Wrapper });
    // The trigger should NOT show 'slack-notify' since it's filtered out
    expect(screen.queryByText('slack-notify')).toBeNull();
  });
});
