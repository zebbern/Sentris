/**
 * Shared dialog mock factories for test files.
 *
 * Usage:
 * ```ts
 * import { createDialogMock, createAlertDialogMock } from '@/test/mocks/dialog';
 * mock.module('@/components/ui/dialog', createDialogMock);
 * mock.module('@/components/ui/alert-dialog', createAlertDialogMock);
 * ```
 *
 * Each test file must still call `mock.module()` at top level — these factories
 * just return the mock object so the boilerplate isn't duplicated.
 */

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function createDialogMock() {
  const Dialog = ({ open, children }: any) => (open ? <>{children}</> : null);
  const DialogContent = ({ children, ...props }: any) => (
    <div role="dialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const passthroughInline = ({ children, ...props }: any) => <span {...props}>{children}</span>;
  const FragmentWrapper = ({ children }: any) => <>{children}</>;

  return {
    Dialog,
    DialogContent,
    DialogHeader: passthrough,
    DialogFooter: passthrough,
    DialogTitle: passthroughInline,
    DialogDescription: passthroughInline,
    DialogPortal: FragmentWrapper,
    DialogOverlay: FragmentWrapper,
    DialogTrigger: FragmentWrapper,
    DialogClose: FragmentWrapper,
  };
}

// ---------------------------------------------------------------------------
// Alert Dialog
// ---------------------------------------------------------------------------

export function createAlertDialogMock() {
  const AlertDialog = ({ open, children }: any) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null;
  const AlertDialogContent = ({ children, ...props }: any) => (
    <div role="alertdialog" {...props}>
      {children}
    </div>
  );
  const passthrough = ({ children, ...props }: any) => <div {...props}>{children}</div>;
  const AlertDialogAction = ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  );
  const AlertDialogCancel = ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  );

  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogPortal: ({ children }: any) => <>{children}</>,
    AlertDialogOverlay: ({ children }: any) => <>{children}</>,
    AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  };
}

// ---------------------------------------------------------------------------
// Confirm Dialog (component stub)
// ---------------------------------------------------------------------------

export function createConfirmDialogMock() {
  return {
    ConfirmDialog: () => null,
  };
}
