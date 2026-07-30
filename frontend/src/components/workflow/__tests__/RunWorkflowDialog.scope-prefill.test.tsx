import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { createSelectMock } from '@/test/mocks/radix-select';
import type { Scope } from '@/types/scopes';

// Mock Radix-based Dialog to avoid jsdom dispatchEvent issues
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

// Mock Radix-based Select with a simple passthrough that exposes options as buttons
mock.module('@/components/ui/select', createSelectMock);

// Mock the api module used for file uploads
mock.module('@/services/api', () => ({
  api: {
    files: {
      upload: mock(() => Promise.resolve({ id: 'file-123' })),
    },
  },
  API_V1_URL: 'http://localhost:4400/api/v1',
}));

mock.module('@/lib/logger', () => ({
  logger: {
    error: mock(() => {}),
    warn: mock(() => {}),
    info: mock(() => {}),
    debug: mock(() => {}),
  },
}));

const exampleScope: Scope = {
  id: 's1',
  organizationId: 'org-1',
  name: 'Example Corp',
  description: null,
  domains: ['example.com', 'app.example.com'],
  repos: [],
  ipRanges: [],
  runtimeValues: {},
  createdBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let mockScopes: Scope[] = [exampleScope];
let mockScopesLoading = false;
let mockScopesError: Error | null = null;

mock.module('@/hooks/queries/useScopeQueries', () => ({
  useScopes: () => ({
    data: mockScopes,
    isLoading: mockScopesLoading,
    error: mockScopesError,
  }),
}));

const { RunWorkflowDialog } = await import('../RunWorkflowDialog');

interface RuntimeInputDef {
  id: string;
  label: string;
  type: 'text' | 'file' | 'number' | 'json' | 'array' | 'string' | 'secret' | 'boolean';
  required: boolean;
  description?: string;
}

function createDefaultProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: mock(() => {}),
    runtimeInputs: [] as RuntimeInputDef[],
    onRun: mock(() => {}),
    initialValues: {} as Record<string, unknown>,
    ...overrides,
  };
}

describe('RunWorkflowDialog scope prefill', () => {
  afterEach(() => {
    cleanup();
    mockScopes = [exampleScope];
    mockScopesLoading = false;
    mockScopesError = null;
  });

  it('shows the "Prefill from target" selector when scopes and runtime inputs exist', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: true },
    ];
    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('Prefill from target')).toBeInTheDocument();
    expect(screen.getByText('Example Corp')).toBeInTheDocument();
    expect(
      screen.getByText('Fill matching inputs (domains, repos, IPs) from a saved target.'),
    ).toBeInTheDocument();
  });

  it('hides the selector when there are no saved scopes', () => {
    mockScopes = [];
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: true },
    ];
    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.queryByText('Prefill from target')).not.toBeInTheDocument();
  });

  it('keeps a zero-input workflow bound to its launch target', () => {
    const onRun = mock(() => {});
    const props = createDefaultProps({ runtimeInputs: [], initialScopeId: 's1', onRun });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('Run against target')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Example Corp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const runButtons = screen.getAllByText('Run Workflow');
    fireEvent.click(runButtons[runButtons.length - 1]);

    expect(onRun).toHaveBeenCalledWith({}, 's1');
  });

  it('cannot silently submit an unscoped run while its launch target is loading', () => {
    mockScopes = [];
    mockScopesLoading = true;
    const onRun = mock(() => {});
    const props = createDefaultProps({ runtimeInputs: [], initialScopeId: 's1', onRun });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByRole('status')).toHaveTextContent('Resolving launch target');
    const runButton = screen.getByRole('button', { name: /run workflow/i });
    expect(runButton).toBeDisabled();
    fireEvent.click(runButton);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('cannot silently submit an unscoped run when its launch target is unavailable', () => {
    mockScopes = [];
    mockScopesError = new Error('target service offline');
    const onRun = mock(() => {});
    const props = createDefaultProps({ runtimeInputs: [], initialScopeId: 's1', onRun });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Launch target is unavailable: target service offline',
    );
    const runButton = screen.getByRole('button', { name: /run workflow/i });
    expect(runButton).toBeDisabled();
    fireEvent.click(runButton);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('prefills matching inputs from the selected target and runs with the merged values', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: true },
    ];
    const onRun = mock(() => {});
    const props = createDefaultProps({ runtimeInputs: inputs, onRun });
    render(<RunWorkflowDialog {...props} />);

    // Select the "Example Corp" option in the Prefill selector.
    fireEvent.click(screen.getByRole('option', { name: 'Example Corp' }));

    // Click Run.
    const runButtons = screen.getAllByText('Run Workflow');
    fireEvent.click(runButtons[runButtons.length - 1]);

    expect(onRun).toHaveBeenCalledWith(
      {
        domains: ['example.com', 'app.example.com'],
      },
      's1',
    );
  });

  it('leaves inputs not covered by the scope untouched', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: true },
      { id: 'authorizationNotes', label: 'Authorization Notes', type: 'text', required: false },
    ];
    const onRun = mock(() => {});
    const props = createDefaultProps({
      runtimeInputs: inputs,
      initialValues: { authorizationNotes: 'pre-authorized by security team' },
      onRun,
    });
    render(<RunWorkflowDialog {...props} />);

    fireEvent.click(screen.getByRole('option', { name: 'Example Corp' }));

    const runButtons = screen.getAllByText('Run Workflow');
    fireEvent.click(runButtons[runButtons.length - 1]);

    expect(onRun).toHaveBeenCalledWith(
      {
        domains: ['example.com', 'app.example.com'],
        authorizationNotes: 'pre-authorized by security team',
      },
      's1',
    );
  });

  it('runs with a null scopeId when no target is selected', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: false },
    ];
    const onRun = mock(() => {});
    const props = createDefaultProps({ runtimeInputs: inputs, onRun });
    render(<RunWorkflowDialog {...props} />);

    const runButtons = screen.getAllByText('Run Workflow');
    fireEvent.click(runButtons[runButtons.length - 1]);

    expect(onRun).toHaveBeenCalledWith({}, null);
  });

  it('binds the Select value to the chosen target', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'domains', label: 'Domains', type: 'array', required: true },
    ];
    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    const option = screen.getByRole('option', { name: 'Example Corp' });
    expect(option).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(option);

    expect(screen.getByRole('option', { name: 'Example Corp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
