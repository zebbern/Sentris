import type React from 'react';
import type { ReactNode, RefObject } from 'react';

export interface WorkflowBuilderShellProps {
  mode: 'design' | 'execution';
  topBar: ReactNode;
  isLibraryVisible: boolean;
  onToggleLibrary: () => void;
  libraryContent: ReactNode;
  canvasContent: ReactNode;
  showScheduleSidebarContainer: boolean;
  isScheduleSidebarVisible: boolean;
  scheduleSidebarContent?: ReactNode;
  isInspectorVisible: boolean;
  inspectorContent?: ReactNode;
  inspectorWidth: number;
  setInspectorWidth: (width: number) => void;
  showLoadingOverlay: boolean;
  scheduleDrawer?: ReactNode;
  runDialog?: ReactNode;
  isConfigPanelVisible?: boolean;
  configPanelContent?: ReactNode;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Floating overlay content for execution mode (e.g., parent run breadcrumbs) */
  executionOverlay?: ReactNode;
  /** Bottom dock panel content (e.g., TerminalDockPanel) */
  terminalDockContent?: ReactNode;
}

export interface LibraryPanelProps {
  isLibraryVisible: boolean;
  showLibraryContent: boolean;
  libraryPanelWidth: number;
  isMobile: boolean;
  libraryContent: ReactNode;
  onToggleLibrary: () => void;
}

export interface LibraryToggleButtonProps {
  mode: 'design' | 'execution';
  isMobile: boolean;
  onToggleLibrary: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface MobileBottomSheetProps {
  mobileSheetHeight: number;
  isDraggingRef: RefObject<boolean>;
  anyMobilePanelVisible: boolean | undefined;
  showMobileHint: boolean;
  isConfigPanelVisible?: boolean;
  isScheduleSidebarVisible: boolean;
  configPanelContent?: ReactNode;
  scheduleSidebarContent?: ReactNode;
  inspectorContent?: ReactNode;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

export interface DesktopInspectorPanelProps {
  isInspectorVisible: boolean;
  inspectorWidth: number;
  isInspectorResizing: boolean;
  inspectorContent?: ReactNode;
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
}
