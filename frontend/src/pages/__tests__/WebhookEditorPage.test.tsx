import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import type { WebhookFormState } from '../webhook-editor/webhookEditorTypes';
import {
  createDialogMock,
  createAlertDialogMock,
  createConfirmDialogMock,
} from '@/test/mocks/dialog';

// --- Mock navigate ---
const mockNavigate = mock();

mock.module('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: 'wh-123' }),
  useLocation: () => ({ pathname: '/webhooks/wh-123', state: null }),
  MemoryRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// --- Mock dialog / alert-dialog (passthrough) ---
mock.module('@/components/ui/dialog', createDialogMock);
mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

// --- Mock Tabs (Radix primitives don't work well in jsdom) ---
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

// --- Mock confirm dialog component ---
mock.module('@/components/ui/confirm-dialog', createConfirmDialogMock);

// --- Mock useDocumentTitle ---
mock.module('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}));

// --- Mock monaco-editor/react ---
mock.module('@monaco-editor/react', () => ({
  loader: { config: () => {} },
  default: ({ value }: any) => <textarea data-testid="monaco-editor" defaultValue={value} />,
}));

// --- Mutable hook state ---
const defaultForm: WebhookFormState = {
  workflowId: 'wf-111',
  name: 'Test Webhook',
  description: 'A test webhook',
  parsingScript: 'export async function script() { return {} }',
  expectedInputs: [],
};

const mockHandleSave = mock();
const mockHandleDelete = mock();
const mockHandleTest = mock();
const mockHandleBack = mock();
const mockSetForm = mock();
const mockNavigateToTab = mock();
const mockSetTestPayload = mock();
const mockSetTestHeaders = mock();
const mockToast = mock();

let hookState: Record<string, any> = {};

const resetHookState = () => {
  hookState = {
    isNew: false,
    isLoading: false,
    activeTab: 'editor',
    navigateToTab: mockNavigateToTab,
    form: { ...defaultForm },
    setForm: mockSetForm,
    isDirty: false,
    isSaving: false,
    webhook: {
      id: 'wh-123',
      name: 'Test Webhook',
      webhookPath: '/api/webhooks/abc123',
      workflowId: 'wf-111',
      parsingScript: 'export async function script() { return {} }',
      expectedInputs: [],
      description: 'A test webhook',
    },
    workflows: [
      { id: 'wf-111', name: 'Scan Network' },
      { id: 'wf-222', name: 'Deploy App' },
    ],
    workflowRuntimeInputs: [],
    testPayload: '{}',
    setTestPayload: mockSetTestPayload,
    testHeaders: '{}',
    setTestHeaders: mockSetTestHeaders,
    isTesting: false,
    testResult: null,
    deliveries: [],
    isLoadingDeliveries: false,
    handleSave: mockHandleSave,
    handleDelete: mockHandleDelete,
    handleTest: mockHandleTest,
    handleBack: mockHandleBack,
    navigate: mockNavigate,
    dialogProps: {
      open: false,
      title: '',
      description: '',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      destructive: false,
      onConfirm: () => {},
      onCancel: () => {},
    },
    toast: mockToast,
  };
};

mock.module('../webhook-editor', () => ({
  useWebhookEditor: () => hookState,
  WebhookEditorHeader: ({
    form,
    onSave,
    onDelete,
    onBack,
  }: {
    form: any;
    onSave: () => void;
    onDelete: () => void;
    onBack: () => void;
  }) => (
    <div data-testid="editor-header">
      <span data-testid="webhook-name">{form.name}</span>
      <button data-testid="save-btn" onClick={onSave}>
        Save
      </button>
      <button data-testid="delete-btn" onClick={onDelete}>
        Delete
      </button>
      <button data-testid="back-btn" onClick={onBack}>
        Webhooks
      </button>
    </div>
  ),
  WebhookFormSection: () => <div data-testid="form-section">Form Section</div>,
  WebhookTestingPanel: () => <div data-testid="testing-panel">Testing Panel</div>,
  WebhookDeliveryLog: () => <div data-testid="delivery-log">Delivery Log</div>,
  WebhookSettingsTab: ({ onDelete }: { onDelete: () => void }) => (
    <div data-testid="settings-tab">
      <button data-testid="settings-delete-btn" onClick={onDelete}>
        Delete Webhook
      </button>
    </div>
  ),
}));

import { WebhookEditorPage } from '../WebhookEditorPage';

const renderEditor = () => render(<WebhookEditorPage />);

describe('WebhookEditorPage', () => {
  beforeEach(() => {
    cleanup();
    resetHookState();
    mockHandleSave.mockClear();
    mockHandleDelete.mockClear();
    mockHandleTest.mockClear();
    mockHandleBack.mockClear();
    mockNavigateToTab.mockClear();
  });

  afterEach(cleanup);

  // --- Loading state ---
  it('shows loading spinner when isLoading is true', () => {
    hookState.isLoading = true;
    renderEditor();
    // Loader2 renders an SVG with animate-spin class
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
  });

  it('does not render tabs or header while loading', () => {
    hookState.isLoading = true;
    renderEditor();
    expect(screen.queryByTestId('editor-header')).toBeNull();
    expect(screen.queryByText('Editor & Test')).toBeNull();
  });

  // --- Render with data ---
  it('renders header with webhook name', () => {
    renderEditor();
    expect(screen.getByTestId('webhook-name').textContent).toBe('Test Webhook');
  });

  it('renders Editor & Test tab', () => {
    renderEditor();
    expect(screen.getByText('Editor & Test')).toBeTruthy();
  });

  it('renders Deliveries tab', () => {
    renderEditor();
    expect(screen.getByText('Deliveries')).toBeTruthy();
  });

  it('renders Settings tab', () => {
    renderEditor();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders "Webhooks" breadcrumb in back button', () => {
    renderEditor();
    expect(screen.getByTestId('back-btn').textContent).toBe('Webhooks');
  });

  // --- Tab switching ---
  it('calls navigateToTab when Deliveries tab is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Deliveries'));
    expect(mockNavigateToTab).toHaveBeenCalledWith('deliveries');
  });

  it('calls navigateToTab when Settings tab is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByText('Settings'));
    expect(mockNavigateToTab).toHaveBeenCalledWith('settings');
  });

  it('disables Deliveries and Settings tabs when isNew', () => {
    hookState.isNew = true;
    renderEditor();
    const deliveriesTab = screen.getByText('Deliveries').closest('button');
    const settingsTab = screen.getByText('Settings').closest('button');
    expect(deliveriesTab?.hasAttribute('disabled')).toBe(true);
    expect(settingsTab?.hasAttribute('disabled')).toBe(true);
  });

  // --- Save handler ---
  it('calls handleSave when save button is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(mockHandleSave).toHaveBeenCalledTimes(1);
  });

  // --- Delete handler ---
  it('calls handleDelete when delete button is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('delete-btn'));
    expect(mockHandleDelete).toHaveBeenCalledTimes(1);
  });

  // --- Back handler ---
  it('calls handleBack when back button is clicked', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('back-btn'));
    expect(mockHandleBack).toHaveBeenCalledTimes(1);
  });

  // --- Active tab content ---
  it('shows form section and testing panel when editor tab is active', () => {
    hookState.activeTab = 'editor';
    renderEditor();
    expect(screen.getByTestId('form-section')).toBeTruthy();
    expect(screen.getByTestId('testing-panel')).toBeTruthy();
  });
});
