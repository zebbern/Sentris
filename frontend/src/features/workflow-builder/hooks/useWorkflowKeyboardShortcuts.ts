import { useEffect, useRef } from 'react';
import type { ToastContextValue } from '@/components/ui/toast-context';

interface UseWorkflowKeyboardShortcutsParams {
  mode: 'design' | 'execution';
  isDirty: boolean;
  isNewWorkflow: boolean;
  handleSave: () => Promise<any>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  toggleDemoComponents: () => void;
  showDemoComponents: boolean;
  toast: ToastContextValue['toast'];
}

/**
 * Extracted from WorkflowBuilderContent: handles keyboard shortcuts
 * (save, undo, redo, demo toggle) and the beforeunload navigation guard.
 */
export function useWorkflowKeyboardShortcuts({
  mode,
  isDirty,
  isNewWorkflow,
  handleSave,
  undo,
  redo,
  canUndo,
  canRedo,
  toggleDemoComponents,
  showDemoComponents,
  toast,
}: UseWorkflowKeyboardShortcutsParams) {
  const isSavingShortcutRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const key = event.key?.toLowerCase();

      // Check if the active element is a text input (input, textarea, or contenteditable)
      // If so, skip intercepting undo/redo to allow native browser behavior
      const activeElement = document.activeElement;
      const isTextInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute('contenteditable') === 'true';

      // Save shortcut: Ctrl/Cmd + S
      const isSaveCombo = (event.metaKey || event.ctrlKey) && key === 's';
      if (isSaveCombo && mode === 'design') {
        event.preventDefault();
        event.stopPropagation();
        if (!isSavingShortcutRef.current) {
          isSavingShortcutRef.current = true;
          void handleSave().finally(() => {
            isSavingShortcutRef.current = false;
          });
        }
        return;
      }

      // Undo shortcut: Ctrl/Cmd + Z (without Shift)
      // Skip if user is typing in a text input to allow native undo
      const isUndoCombo = (event.metaKey || event.ctrlKey) && key === 'z' && !event.shiftKey;
      if (isUndoCombo && mode === 'design' && !isTextInput) {
        event.preventDefault();
        event.stopPropagation();
        if (canUndo) {
          undo();
        }
        return;
      }

      // Redo shortcut: Ctrl/Cmd + Shift + Z OR Ctrl/Cmd + Y
      // Skip if user is typing in a text input to allow native redo
      const isRedoCombo =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'z') ||
        ((event.metaKey || event.ctrlKey) && key === 'y');
      if (isRedoCombo && mode === 'design' && !isTextInput) {
        event.preventDefault();
        event.stopPropagation();
        if (canRedo) {
          redo();
        }
        return;
      }

      // Demo components toggle shortcut: Ctrl/Cmd + Shift + D
      const isDemoToggleCombo = (event.metaKey || event.ctrlKey) && event.shiftKey && key === 'd';
      if (isDemoToggleCombo) {
        event.preventDefault();
        event.stopPropagation();
        toggleDemoComponents();
        const isNowVisible = !showDemoComponents; // because it was just toggled
        toast({
          title: isNowVisible ? 'Debug mode enabled' : 'Debug mode disabled',
          description: isNowVisible
            ? 'Showing demo components and undo stack'
            : 'Hidden demo components and undo stack',
          duration: 2000,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleSave,
    mode,
    toggleDemoComponents,
    showDemoComponents,
    toast,
    undo,
    redo,
    canUndo,
    canRedo,
  ]);

  // --- Unsaved changes guard ---
  // Block browser-level navigation (refresh, close tab, browser back)
  const shouldBlockNavigation = isDirty && mode === 'design' && !isNewWorkflow;
  useEffect(() => {
    if (!shouldBlockNavigation) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlockNavigation]);
}
