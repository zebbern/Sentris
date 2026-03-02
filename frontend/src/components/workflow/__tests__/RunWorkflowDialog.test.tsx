import { describe, it, afterEach, expect, mock } from 'bun:test';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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

const { RunWorkflowDialog } = await import('../RunWorkflowDialog');

interface RuntimeInputDef {
  id: string;
  label: string;
  type: 'text' | 'file' | 'number' | 'json' | 'array' | 'string' | 'secret';
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

describe('RunWorkflowDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders dialog with title and run button', () => {
    const props = createDefaultProps();
    render(<RunWorkflowDialog {...props} />);

    // "Run Workflow" appears as both the dialog title and the submit button text
    const runWorkflowElements = screen.getAllByText('Run Workflow');
    expect(runWorkflowElements.length).toBe(2);
    expect(screen.getByText('Click Run to start the workflow execution.')).toBeInTheDocument();
  });

  it('renders runtime input fields from props', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'target', label: 'Target Host', type: 'text', required: true },
      { id: 'port', label: 'Port Number', type: 'number', required: false },
    ];

    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('Target Host')).toBeInTheDocument();
    expect(screen.getByText('Port Number')).toBeInTheDocument();
  });

  it('shows description text for input fields', () => {
    const inputs: RuntimeInputDef[] = [
      {
        id: 'target',
        label: 'Target',
        type: 'text',
        required: false,
        description: 'The hostname or IP to scan',
      },
    ];

    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('The hostname or IP to scan')).toBeInTheDocument();
  });

  it('shows required indicator on required fields', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'target', label: 'Target', type: 'text', required: true },
    ];

    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('validates required fields and shows error on submit', async () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'target', label: 'Target', type: 'text', required: true },
    ];
    const onRun = mock(() => {});

    const props = createDefaultProps({ runtimeInputs: inputs, onRun });
    render(<RunWorkflowDialog {...props} />);

    // Click Run without filling required field
    const runButtons = screen.getAllByText('Run Workflow');
    // The second "Run Workflow" is the button in the footer
    const runButton = runButtons[runButtons.length - 1];
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(screen.getByText('This field is required')).toBeInTheDocument();
    });

    // onRun should not have been called
    expect(onRun).not.toHaveBeenCalled();
  });

  it('renders file input for file-type inputs', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'report', label: 'Upload Report', type: 'file', required: false },
    ];

    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('Upload Report')).toBeInTheDocument();
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
  });

  it('calls onOpenChange(false) when cancel is clicked', () => {
    const onOpenChange = mock(() => {});
    const props = createDefaultProps({ onOpenChange });
    render(<RunWorkflowDialog {...props} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows helper text for inputs description when no runtime inputs', () => {
    const props = createDefaultProps({ runtimeInputs: [] });
    render(<RunWorkflowDialog {...props} />);

    expect(screen.getByText('Click Run to start the workflow execution.')).toBeInTheDocument();
  });

  it('shows helper text when runtime inputs exist', () => {
    const inputs: RuntimeInputDef[] = [
      { id: 'target', label: 'Target', type: 'text', required: false },
    ];

    const props = createDefaultProps({ runtimeInputs: inputs });
    render(<RunWorkflowDialog {...props} />);

    expect(
      screen.getByText('Provide the required inputs to start the workflow.'),
    ).toBeInTheDocument();
  });
});
