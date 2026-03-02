import { describe, it, expect, mock, afterEach, beforeEach } from 'bun:test';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createDialogMock } from '@/test/mocks/dialog';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE import)
// ---------------------------------------------------------------------------

mock.module('@/components/ui/dialog', createDialogMock);

mock.module('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {typeof children === 'function' ? children({ onValueChange }) : children}
    </div>
  ),
  SelectTrigger: ({ children, id }: any) => (
    <button data-testid="select-trigger" id={id}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <option data-testid={`select-item-${value}`} value={value}>
      {children}
    </option>
  ),
}));

// Mock useTemplates query hook
let mockTemplates: any[] = [];
mock.module('@/hooks/queries/useTemplateQueries', () => ({
  useTemplates: () => ({
    data: mockTemplates,
    isLoading: false,
  }),
}));

// Mock useCopyToClipboard
const mockCopy = mock(() => Promise.resolve(true));
let mockCopiedText: string | null = null;
mock.module('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: mockCopy,
    copiedText: mockCopiedText,
  }),
}));

// Mock API
mock.module('@/services/api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  getApiAuthHeaders: () => Promise.resolve({ Authorization: 'Bearer test' }),
}));

import { PublishTemplateModal } from '../PublishTemplateModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(overrides: Partial<Parameters<typeof PublishTemplateModal>[0]> = {}) {
  const defaultProps = {
    workflowId: 'wf-123',
    workflowName: 'Test Workflow',
    open: true,
    onOpenChange: mock(() => {}),
    onSuccess: mock(() => {}),
    ...overrides,
  };

  return {
    ...render(<PublishTemplateModal {...defaultProps} />),
    props: defaultProps,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PublishTemplateModal', () => {
  beforeEach(() => {
    mockTemplates = [];
    mockCopiedText = null;
    mockCopy.mockReset();
    mockCopy.mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    cleanup();
  });

  it('renders dialog with publish title', () => {
    renderModal();

    expect(screen.getByText('Publish as Template')).toBeTruthy();
  });

  it('renders StepIndicator at configure step', () => {
    renderModal();

    // The step indicator should show the "Configure" label
    expect(screen.getByText('Configure')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Publish')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('renders ConfigureStepForm as initial step', () => {
    renderModal();

    // The configure form should be visible with its fields
    expect(screen.getByLabelText('Template Name *')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByLabelText('Author / Organization *')).toBeTruthy();
  });

  it('pre-fills name from workflowName prop', () => {
    renderModal({ workflowName: 'My Security Workflow' });

    const input = screen.getByLabelText('Template Name *') as HTMLInputElement;
    expect(input.value).toBe('My Security Workflow');
  });

  it('close fires onOpenChange(false)', () => {
    const onOpenChange = mock(() => {});
    renderModal({ onOpenChange });

    fireEvent.click(screen.getByText('Cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when open is false', () => {
    renderModal({ open: false });

    expect(screen.queryByText('Publish as Template')).toBeNull();
  });

  it('shows update title when existing template matches', () => {
    mockTemplates = [
      {
        id: 'tpl-1',
        name: 'Test Workflow',
        path: 'templates/test-workflow.json',
        category: 'Security',
        tags: [],
        requiredSecrets: [],
      },
    ];

    renderModal({ workflowName: 'Test Workflow' });

    expect(screen.getByText('Update Template')).toBeTruthy();
  });

  it('shows validation error when name is empty on submit', async () => {
    renderModal();

    // Clear the name field
    const nameInput = screen.getByLabelText('Template Name *') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    // Try to submit
    fireEvent.click(screen.getByText('Next: Review'));

    await waitFor(() => {
      expect(screen.getByText('Please enter a template name')).toBeTruthy();
    });
  });

  it('renders navigation aria-label on step indicator', () => {
    renderModal();

    const nav = screen.getByRole('navigation', { name: 'Publishing progress' });
    expect(nav).toBeTruthy();
  });
});
