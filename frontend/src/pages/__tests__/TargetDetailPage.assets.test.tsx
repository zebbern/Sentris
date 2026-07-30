import { describe, it, beforeEach, afterEach, expect, mock, afterAll } from 'bun:test';
import { restoreMockedModules, realModuleExports } from '@/test/restore-mocks';
import { fireEvent, screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render-with-providers';
import type { Scope, Asset } from '@/types/scopes';
import type { ScopeRunSummary } from '@/hooks/queries/useScopeQueries';

// --- Mock isolation ---
mock.module('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));

// --- Mock useParams (route param), keep the rest of react-router-dom real ---
mock.module('react-router-dom', () => ({
  ...realModuleExports('react-router-dom'),
  useParams: () => ({ id: 'scope-001' }),
}));

// --- Mock Tabs (Radix primitives use pointer events that jsdom doesn't emulate well) ---
let tabChangeCallback: ((value: string) => void) | null = null;

mock.module('@/components/ui/tabs', () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
    ...props
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => {
    tabChangeCallback = onValueChange;
    return (
      <div data-testid="tabs" data-value={value} {...props}>
        {children}
      </div>
    );
  },
  TabsList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  TabsTrigger: ({
    value,
    children,
    disabled,
    ...props
  }: {
    value: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      role="tab"
      data-value={value}
      disabled={disabled}
      onClick={() => !disabled && tabChangeCallback?.(value)}
      {...props}
    >
      {children}
    </button>
  ),
  TabsContent: ({ value, children, ...props }: { value: string; children: React.ReactNode }) => (
    <div data-tab-content={value} {...props}>
      {children}
    </div>
  ),
}));

// --- Mutable mock state for scope + runs + assets queries ---
const mockState: {
  scope: Scope | undefined;
  isLoadingScope: boolean;
  runs: ScopeRunSummary[];
  isLoadingRuns: boolean;
  assets: Asset[];
  isLoadingAssets: boolean;
  assetsError: Error | null;
} = {
  scope: undefined,
  isLoadingScope: false,
  runs: [],
  isLoadingRuns: false,
  assets: [],
  isLoadingAssets: false,
  assetsError: null,
};

mock.module('@/hooks/queries/useScopeQueries', () => ({
  useScope: () => ({ data: mockState.scope, isLoading: mockState.isLoadingScope, error: null }),
  useScopeRuns: () => ({ data: mockState.runs, isLoading: mockState.isLoadingRuns, error: null }),
  useTargetAssets: () => ({
    data: mockState.assets,
    isLoading: mockState.isLoadingAssets,
    error: mockState.assetsError,
  }),
  useAssetRunComparison: () => ({ data: undefined, isLoading: false, error: null }),
  useTargetFindings: () => ({
    data: [],
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: mock(),
  }),
}));

// Import AFTER mocks
import { TargetDetailPage } from '@/pages/TargetDetailPage';

// --- Fixtures ---
const ISO = '2024-06-15T12:00:00.000Z';

const scope: Scope = {
  id: 'scope-001',
  organizationId: 'org-001',
  name: 'Contoso Ltd',
  description: 'Primary target',
  domains: ['contoso.com', 'app.contoso.com'],
  repos: ['contoso/infra'],
  ipRanges: [],
  runtimeValues: {},
  createdBy: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const makeAsset = (o: Partial<Asset> = {}): Asset => ({
  id: 'asset-001',
  organizationId: 'org-001',
  scopeId: 'scope-001',
  assetType: 'subdomain',
  assetValue: 'api.contoso.com',
  firstSeenAt: ISO,
  lastSeenAt: ISO,
  firstSeenRunId: 'run-001',
  lastSeenRunId: 'run-001',
  sourceComponentId: 'subfinder',
  metadata: {},
  createdAt: ISO,
  updatedAt: ISO,
  ...o,
});

const setup = (o: Partial<typeof mockState> = {}) => {
  mockState.scope = o.scope ?? scope;
  mockState.isLoadingScope = o.isLoadingScope ?? false;
  mockState.runs = o.runs ?? [];
  mockState.isLoadingRuns = o.isLoadingRuns ?? false;
  mockState.assets = o.assets ?? [];
  mockState.isLoadingAssets = o.isLoadingAssets ?? false;
  mockState.assetsError = o.assetsError ?? null;
};

const renderPage = () =>
  renderWithProviders(<TargetDetailPage />, { initialEntries: ['/targets/scope-001'] });

// --- Teardown ---
afterAll(() =>
  restoreMockedModules([
    '@/hooks/useDocumentTitle',
    'react-router-dom',
    '@/components/ui/tabs',
    '@/hooks/queries/useScopeQueries',
  ]),
);

// --- Tests ---
describe('TargetDetailPage assets tab', () => {
  beforeEach(() => {
    cleanup();
    setup();
  });
  afterEach(cleanup);

  it('shows an asset row with its value and type on the Assets tab', () => {
    setup({ assets: [makeAsset()] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /assets/i }));
    expect(screen.getByText('api.contoso.com')).toBeInTheDocument();
    expect(screen.getAllByText('subdomain').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: /open source run run-001/i })).toHaveAttribute(
      'href',
      '/runs/run-001',
    );
  });

  it('shows "No assets yet" empty state when there are no assets', () => {
    setup({ assets: [] });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /assets/i }));
    expect(screen.getByText('No assets yet')).toBeInTheDocument();
  });

  it('shows an asset query failure as unavailable instead of an empty asset list', () => {
    setup({ assets: [], assetsError: new Error('asset service offline') });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /assets/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Assets are unavailable: asset service offline/i,
    );
    expect(screen.queryByText('No assets yet')).not.toBeInTheDocument();
  });

  it('filters the asset view by type', () => {
    setup({
      assets: [
        makeAsset(),
        makeAsset({
          id: 'asset-002',
          assetType: 'ip-address',
          assetValue: '203.0.113.10',
        }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /assets/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /filter assets by type/i }), {
      target: { value: 'ip-address' },
    });

    expect(screen.queryByText('api.contoso.com')).not.toBeInTheDocument();
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument();
  });
});
