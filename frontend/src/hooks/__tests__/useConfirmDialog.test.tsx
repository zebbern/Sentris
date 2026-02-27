import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock the AlertDialog primitives so they render plain HTML in jsdom
mock.module('@/components/ui/alert-dialog', () => {
  const AlertDialog = ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null;
  const AlertDialogContent = ({ children, ...props }: any) => (
    <div role="alertdialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>;

  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthroughInline,
    AlertDialogDescription: passthroughInline,
    AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    AlertDialogPortal: ({ children }: any) => <>{children}</>,
    AlertDialogOverlay: ({ children }: any) => <>{children}</>,
    AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  };
});

import { useConfirmDialog } from '../useConfirmDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Test harness — a component that uses the hook and renders the dialog
// ---------------------------------------------------------------------------

function TestHarness() {
  const { confirm, dialogProps } = useConfirmDialog();

  const handleDelete = async () => {
    const result = await confirm({
      title: 'Delete item?',
      description: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
    });
    // Store the result in a data attribute so tests can read it
    const el = document.getElementById('result');
    if (el) el.textContent = String(result);
  };

  return (
    <div>
      <button data-testid="trigger" onClick={handleDelete}>
        Open
      </button>
      <span id="result" data-testid="result" />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useConfirmDialog', () => {
  it('dialog is not visible initially', () => {
    render(<TestHarness />);

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens the dialog when confirm() is called', async () => {
    render(<TestHarness />);

    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Delete item?')).toBeTruthy();
    expect(screen.getByText('This action cannot be undone.')).toBeTruthy();
  });

  it('shows custom confirm and cancel labels', async () => {
    render(<TestHarness />);

    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });

    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Keep')).toBeTruthy();
  });

  it('resolves with true when confirm action is clicked', async () => {
    render(<TestHarness />);

    // Open dialog
    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });

    // Click confirm
    await act(() => {
      fireEvent.click(screen.getByText('Delete'));
    });

    // Dialog closes
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // Promise resolved with true
    expect(screen.getByTestId('result').textContent).toBe('true');
  });

  it('resolves with false when cancel action is clicked', async () => {
    render(<TestHarness />);

    // Open dialog
    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });

    // Click cancel
    await act(() => {
      fireEvent.click(screen.getByText('Keep'));
    });

    // Dialog closes
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // Promise resolved with false
    expect(screen.getByTestId('result').textContent).toBe('false');
  });

  it('dialog closes after confirming', async () => {
    render(<TestHarness />);

    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await act(() => {
      fireEvent.click(screen.getByText('Delete'));
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('dialog closes after cancelling', async () => {
    render(<TestHarness />);

    await act(() => {
      fireEvent.click(screen.getByTestId('trigger'));
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await act(() => {
      fireEvent.click(screen.getByText('Keep'));
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
