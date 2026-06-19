import { describe, it, expect, mock, afterEach, afterAll, vi } from 'bun:test';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { restoreMockedModules } from '@/test/restore-mocks';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getMock = vi.fn();
const exportMock = vi.fn();
const getStatsMock = vi.fn();
const listMock = vi.fn();

mock.module('@/services/api', () => ({
  api: {
    findings: {
      list: listMock,
      get: getMock,
      exportFindings: exportMock,
      getStats: getStatsMock,
    },
  },
}));

mock.module('@/services/api/findings', () => ({
  findingsApi: {
    list: listMock,
    get: getMock,
    exportFindings: exportMock,
    getStats: getStatsMock,
  },
}));

mock.module('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: toastMock,
    dismiss: vi.fn(),
  }),
}));

// --- DropdownMenu: render items directly for testability in JSDOM ---
mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild: _asChild }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <button onClick={onClick} role="menuitem">
      {children}
    </button>
  ),
}));

// --- Sheet: render content directly for testability in JSDOM ---
mock.module('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}));

const toastMock = vi.fn();

// Must import AFTER mock.module
import { ExportButton } from '../ExportButton';
import { SeverityChart } from '../SeverityChart';
import { FindingDetailSheet } from '../FindingDetailSheet';

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

afterAll(() => {
  restoreMockedModules([
    '@/services/api',
    '@/services/api/findings',
    '@/components/ui/use-toast',
    '@/components/ui/dropdown-menu',
    '@/components/ui/sheet',
  ]);
});

// ---------------------------------------------------------------------------
// ExportButton
// ---------------------------------------------------------------------------

describe('ExportButton', () => {
  it('renders the export button', () => {
    render(<ExportButton />, { wrapper: Wrapper });
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('shows dropdown menu with CSV and JSON options on click', async () => {
    render(<ExportButton />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(screen.getByText('Export as CSV')).toBeTruthy();
      expect(screen.getByText('Export as JSON')).toBeTruthy();
    });
  });

  it('calls exportFindings with csv format when CSV option is clicked', async () => {
    exportMock.mockResolvedValueOnce(new Blob(['test'], { type: 'text/csv' }));

    // Mock createObjectURL and revokeObjectURL
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    render(<ExportButton severity="high" search="test" />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(screen.getByText('Export as CSV')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export as CSV'));

    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledWith({
        format: 'csv',
        severity: 'high',
        search: 'test',
      });
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});

// ---------------------------------------------------------------------------
// SeverityChart
// ---------------------------------------------------------------------------

describe('SeverityChart', () => {
  it('renders nothing when there is no data', async () => {
    getStatsMock.mockResolvedValueOnce({
      severityCounts: [
        { severity: 'critical', count: 0 },
        { severity: 'high', count: 0 },
      ],
      total: 0,
    });

    const { container } = render(<SeverityChart />, { wrapper: Wrapper });

    // Wait for query to settle
    await waitFor(() => {
      // Should render nothing when all counts are zero
      expect(container.querySelector('.recharts-responsive-container')).toBeNull();
    });
  });

  it('shows loading skeleton while data loads', () => {
    // Don't resolve the mock — keep it pending
    getStatsMock.mockReturnValue(new Promise(() => {}));

    render(<SeverityChart />, { wrapper: Wrapper });

    expect(screen.getByText('Severity Distribution')).toBeTruthy();
  });

  it('renders chart container when severity data has non-zero counts', async () => {
    getStatsMock.mockResolvedValueOnce({
      severityCounts: [
        { severity: 'critical', count: 5 },
        { severity: 'high', count: 10 },
        { severity: 'medium', count: 20 },
      ],
      total: 35,
    });

    const { container } = render(<SeverityChart />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// FindingDetailSheet
// ---------------------------------------------------------------------------

describe('FindingDetailSheet', () => {
  const mockFinding = {
    id: 'finding-1',
    timestamp: '2025-06-15T12:00:00.000Z',
    severity: 'high',
    name: 'SQL Injection',
    asset_key: 'example.com',
    workflow_name: 'Web Scan',
    workflow_id: 'wf-1',
    run_id: 'run-1',
    component_id: 'comp-1',
    node_ref: 'node-1',
    raw: { '@timestamp': '2025-06-15T12:00:00.000Z', severity: 'high', custom: 'data' },
  };

  it('renders sheet with title when isOpen is true', async () => {
    getMock.mockResolvedValueOnce(mockFinding);

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText('Finding Details')).toBeTruthy();
    });
  });

  it('shows loading skeleton while query is pending', () => {
    getMock.mockReturnValue(new Promise(() => {}));

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText('Finding Details')).toBeTruthy();
    // aria-busy is set on loading container
    const loadingContainer = document.querySelector('[aria-busy="true"]');
    expect(loadingContainer).not.toBeNull();
  });

  it('displays finding fields when data is loaded', async () => {
    getMock.mockResolvedValueOnce(mockFinding);

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      // "SQL Injection" appears in both SheetDescription and the Name row
      expect(screen.getAllByText('SQL Injection').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('Web Scan')).toBeTruthy();
  });

  it('shows raw data toggle button', async () => {
    getMock.mockResolvedValueOnce(mockFinding);

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText('Raw Data')).toBeTruthy();
    });

    // Button should be collapsed initially
    const rawButton = screen.getByText('Raw Data');
    expect(rawButton.closest('button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands raw JSON when raw data toggle is clicked', async () => {
    getMock.mockResolvedValueOnce(mockFinding);

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(screen.getByText('Raw Data')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Raw Data'));

    await waitFor(() => {
      const pre = document.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('"severity"');
    });
  });
});

// ---------------------------------------------------------------------------
// ExportButton — error handling
// ---------------------------------------------------------------------------

describe('ExportButton — error handling', () => {
  it('shows toast notification when export fails', async () => {
    exportMock.mockRejectedValueOnce(new Error('Network error'));

    render(<ExportButton />, { wrapper: Wrapper });

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(screen.getByText('Export as JSON')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export as JSON'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Export failed' }));
    });
  });
});
