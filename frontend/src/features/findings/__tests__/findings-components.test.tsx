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
import { buildSeverityChartData } from '../severityChartData';
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
    exportMock.mockResolvedValueOnce({
      blob: new Blob(['test'], { type: 'text/csv' }),
      availability: 'available',
      projectionHealthReason: null,
      projectionReconciledThrough: null,
      schemaCoverage: { canonical: 1, legacy: 0, invalid: 0 },
      headers: new Headers(),
    });

    // Mock createObjectURL and revokeObjectURL
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    render(<ExportButton severity="high" search="test" triageStatus="fixed" />, {
      wrapper: Wrapper,
    });

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
        triageStatus: 'fixed',
      });
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('warns when the downloaded export was produced from degraded data', async () => {
    exportMock.mockResolvedValueOnce({
      blob: new Blob(['test'], { type: 'application/json' }),
      availability: 'degraded',
      projectionHealthReason: 'projection_events_pending',
      projectionReconciledThrough: null,
      schemaCoverage: { canonical: 1, legacy: 0, invalid: 1 },
      headers: new Headers(),
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    render(<ExportButton />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Export as JSON'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export completed with degraded data',
        }),
      );
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('warns when export data-quality headers are unavailable', async () => {
    exportMock.mockResolvedValueOnce({
      blob: new Blob(['test'], { type: 'text/csv' }),
      availability: 'unknown',
      projectionHealthReason: null,
      projectionReconciledThrough: null,
      schemaCoverage: null,
      headers: new Headers(),
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-url');
    URL.revokeObjectURL = vi.fn();

    render(<ExportButton />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Export as CSV'));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Export data quality unknown',
        }),
      );
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
      availability: 'available',
      schemaCoverage: { canonical: 0, legacy: 0, invalid: 0 },
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
      availability: 'available',
      schemaCoverage: { canonical: 35, legacy: 0, invalid: 0 },
    });

    const { container } = render(<SeverityChart />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
    });
  });

  it('surfaces an unavailable chart query instead of rendering an empty chart', async () => {
    getStatsMock.mockRejectedValueOnce(new Error('Findings data is unavailable'));

    render(<SeverityChart />, { wrapper: Wrapper });

    expect(await screen.findByText('Findings data is unavailable')).toBeTruthy();
  });

  it('marks chart values as degraded with projection and schema context', async () => {
    getStatsMock.mockResolvedValueOnce({
      severityCounts: [{ severity: 'high', count: 2 }],
      total: 2,
      availability: 'degraded',
      projectionHealth: {
        availability: 'degraded',
        completedAt: null,
        reconciledThrough: null,
        reason: 'projection_events_pending',
      },
      schemaCoverage: { canonical: 1, legacy: 0, invalid: 1 },
    });

    render(<SeverityChart />, { wrapper: Wrapper });

    const status = await screen.findByRole('status', { name: /Severity data quality/i });
    expect(status.textContent).toContain('projection events pending');
    expect(status.textContent).toContain('1 invalid');
  });

  it('renders the canonical none severity bucket instead of dropping it', () => {
    expect(buildSeverityChartData([{ severity: 'none', count: 4 }])).toEqual([
      { severity: 'None', count: 4, key: 'none' },
    ]);
  });

  it('sums legacy case variants into the canonical severity bucket', () => {
    expect(
      buildSeverityChartData([
        { severity: 'HIGH', count: 2 },
        { severity: 'high', count: 3 },
        { severity: 'High', count: 5 },
      ]),
    ).toEqual([{ severity: 'High', count: 10, key: 'high' }]);
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
    availability: 'available' as const,
    schemaCompatibility: 'canonical' as const,
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

  it('surfaces degraded detail availability and invalid schema compatibility', async () => {
    getMock.mockResolvedValueOnce({
      ...mockFinding,
      availability: 'degraded',
      schemaCompatibility: 'invalid',
    });

    render(<FindingDetailSheet findingId="finding-1" isOpen={true} onClose={vi.fn()} />, {
      wrapper: Wrapper,
    });

    const status = await screen.findByRole('status', { name: /Finding data quality/i });
    expect(status.textContent).toContain('degraded');
    expect(status.textContent).toContain('invalid');
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
