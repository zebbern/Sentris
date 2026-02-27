import { useCallback, useEffect, useRef, useState } from 'react';

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  /** Label for the confirm button. Defaults to `"Continue"`. */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to `"Cancel"`. */
  cancelLabel?: string;
  /** When true the confirm button uses the destructive variant. Defaults to `true`. */
  destructive?: boolean;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

interface UseConfirmDialogReturn {
  /** Imperatively open the dialog and wait for the user's decision. */
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  /** Props to spread onto a `<ConfirmDialog>` renderer in JSX. */
  dialogProps: ConfirmDialogProps;
}

/**
 * Headless hook that drives a confirm/cancel dialog.
 *
 * Usage:
 * ```tsx
 * const { confirm, dialogProps } = useConfirmDialog();
 *
 * const handleDelete = async () => {
 *   const ok = await confirm({ title: 'Delete?', description: '…' });
 *   if (!ok) return;
 *   // proceed
 * };
 *
 * return <>…<ConfirmDialog {...dialogProps} /></>;
 * ```
 */
export function useConfirmDialog(): UseConfirmDialogReturn {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Continue',
    cancelLabel: 'Cancel',
    destructive: true,
  });

  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? 'Continue',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        destructive: options.destructive ?? true,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      title: state.title,
      description: state.description,
      confirmLabel: state.confirmLabel,
      cancelLabel: state.cancelLabel,
      destructive: state.destructive,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
