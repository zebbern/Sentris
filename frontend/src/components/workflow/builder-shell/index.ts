// Re-export main component for backward compatibility
export { WorkflowBuilderShell } from '../WorkflowBuilderShell';

// Export sub-components for potential reuse
export { LibraryPanel } from './LibraryPanel';
export { LibraryToggleButton } from './LibraryToggleButton';
export { LoadingOverlay } from './LoadingOverlay';
export { MobileBottomSheet } from './MobileBottomSheet';
export { DesktopInspectorPanel } from './DesktopInspectorPanel';

// Export hooks
export { useMobileSheet } from './useMobileSheet';
export { useInspectorResize } from './useInspectorResize';

// Export types
export type {
  WorkflowBuilderShellProps,
  LibraryPanelProps,
  LibraryToggleButtonProps,
  MobileBottomSheetProps,
  DesktopInspectorPanelProps,
} from './types';

// Export constants
export { LIBRARY_PANEL_WIDTH, LIBRARY_PANEL_WIDTH_MOBILE } from './constants';
