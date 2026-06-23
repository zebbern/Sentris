import { useState, useRef, type ChangeEvent, useEffect } from 'react';
import type { ExportFormat } from '@/features/workflow-builder/hooks/useWorkflowImportExport';
import { useIsMac } from '@/hooks/useIsMac';
import { buildOpenSearchUrl } from './buildOpenSearchUrl';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  Play,
  PencilLine,
  MonitorPlay,
  Upload,
  Download,
  Loader2,
  Pencil,
  MoreVertical,
  Undo2,
  Redo2,
  ExternalLink,
  Package,
  History,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { useAuthStore, DEFAULT_ORG_ID } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { env } from '@/config/env';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
const TOOLBAR_BUTTON_CLASS = 'h-8 shrink-0 px-2.5 text-xs';
const TOOLBAR_ICON_BUTTON_CLASS = 'h-8 w-8 shrink-0';

interface TopBarProps {
  workflowId?: string;
  selectedRunId?: string | null;
  selectedRunStatus?: string | null;
  selectedRunOrgId?: string | null;
  onRun?: () => void;
  onSave: () => Promise<void> | void;
  onImport?: (file: File) => Promise<void> | void;
  onExport?: (format?: ExportFormat) => void;
  onPublishTemplate?: () => void;
  canManageWorkflows?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  isInWorkflowBuilder?: boolean;
  hasAnalyticsSink?: boolean;
  onToggleVersionHistory?: () => void;
}

const DEFAULT_WORKFLOW_NAME = 'Untitled Workflow';

export function TopBar({
  workflowId,
  selectedRunId,
  selectedRunStatus,
  selectedRunOrgId,
  isInWorkflowBuilder,
  onRun,
  onSave,
  onImport,
  onExport,
  onPublishTemplate,
  canManageWorkflows = true,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasAnalyticsSink = false,
  onToggleVersionHistory,
}: TopBarProps) {
  const navigate = useNavigate();
  const isMac = useIsMac();
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [saveBeforeRunOpen, setSaveBeforeRunOpen] = useState(false);
  const [tempWorkflowName, setTempWorkflowName] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showPencil, setShowPencil] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const metadata = useWorkflowStore((s) => s.metadata);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const mode = useWorkflowUiStore((state) => state.mode);
  const organizationId = useAuthStore((s) => s.organizationId);
  const authProvider = useAuthStore((s) => s.provider);
  // For Clerk auth, org context is ready when organizationId is set to a real value (not default)
  // For other providers (local, custom), org context is always ready
  const isOrgReady = authProvider !== 'clerk' || organizationId !== DEFAULT_ORG_ID;
  const canEdit = Boolean(canManageWorkflows);
  const { toast } = useToast();

  const handleChangeWorkflowName = () => {
    const trimmed = (tempWorkflowName ?? '').trim();
    if (!trimmed) {
      setWorkflowName(DEFAULT_WORKFLOW_NAME);
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME);
      setIsEditingTitle(false);
      toast({
        title: 'Workflow name cannot be empty',
        description: `Using "${DEFAULT_WORKFLOW_NAME}" as the default name.`,
      });
      return;
    }
    if (trimmed !== metadata.name) {
      setWorkflowName(trimmed);
    }
    setIsEditingTitle(false);
  };

  const handleStartEditing = () => {
    if (!canEdit) return;
    setIsEditingTitle(true);
    // Focus the input after a brief delay to ensure it's rendered
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleChangeWorkflowName();
    } else if (e.key === 'Escape') {
      setTempWorkflowName(metadata.name || DEFAULT_WORKFLOW_NAME);
      setIsEditingTitle(false);
    }
  };

  const needsSaveBeforeRun = mode === 'design' && (isDirty || !workflowId || workflowId === 'new');

  const handleRun = () => {
    if (!canEdit) {
      return;
    }
    if (needsSaveBeforeRun) {
      setSaveBeforeRunOpen(true);
      return;
    }
    onRun?.();
  };

  const handleSaveFromDialog = async (andRun: boolean) => {
    setIsSaving(true);
    try {
      await Promise.resolve(onSave());
      if (!useWorkflowStore.getState().isDirty) {
        setSaveBeforeRunOpen(false);
        if (andRun) {
          onRun?.();
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportClick = () => {
    if (!canEdit) {
      return;
    }
    if (!onImport) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) {
      event.target.value = '';
      return;
    }
    if (!onImport) return;
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      setIsImporting(true);
      await onImport(file);
    } catch (error: unknown) {
      logger.error('Failed to import workflow:', error);
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    if (metadata.name) {
      setTempWorkflowName(metadata.name);
    } else {
      setTempWorkflowName(DEFAULT_WORKFLOW_NAME);
    }
  }, [metadata.name]);

  const showAnalyticsOption = Boolean(
    env.VITE_OPENSEARCH_DASHBOARDS_URL &&
    workflowId &&
    (!selectedRunId || (selectedRunStatus && selectedRunStatus !== 'RUNNING')),
  );

  const handleViewAnalytics = () => {
    if (!showAnalyticsOption || !isOrgReady || !hasAnalyticsSink || !workflowId) return;
    const url = buildOpenSearchUrl({
      baseUrl: env.VITE_OPENSEARCH_DASHBOARDS_URL!,
      workflowId,
      runId: selectedRunId,
      orgId: selectedRunOrgId || organizationId,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const showOverflowMenu =
    mode === 'design' || showAnalyticsOption || (onPublishTemplate && isInWorkflowBuilder);

  const modeToggle = (
    <div className="inline-flex shrink-0 items-center rounded-md border bg-muted/40 p-0.5 text-xs font-medium shadow-sm">
      <Button
        variant={mode === 'design' ? 'default' : 'ghost'}
        size="sm"
        className={cn(TOOLBAR_BUTTON_CLASS, 'gap-1.5 rounded-sm px-2 sm:px-2.5')}
        onClick={() => {
          if (!canEdit || !workflowId) return;
          navigate(`/workflows/${workflowId}`);
        }}
        disabled={!canEdit}
        aria-pressed={mode === 'design'}
      >
        <PencilLine className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Design</span>
      </Button>
      <Button
        variant={mode === 'execution' ? 'default' : 'ghost'}
        size="sm"
        className={cn(TOOLBAR_BUTTON_CLASS, 'gap-1.5 rounded-sm px-2 sm:px-2.5')}
        onClick={() => {
          if (!workflowId) return;
          const executionPath = selectedRunId
            ? `/workflows/${workflowId}/runs/${selectedRunId}`
            : `/workflows/${workflowId}/runs`;
          navigate(executionPath);
        }}
        aria-pressed={mode === 'execution'}
      >
        <MonitorPlay className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">Execute</span>
      </Button>
    </div>
  );

  return (
    <>
      <div className="min-h-[52px] border-b bg-background flex flex-nowrap items-center gap-2 px-2 md:px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          aria-label="Back to workflows"
          className={TOOLBAR_ICON_BUTTON_CLASS}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 justify-self-start">
            <div
              className={cn(
                'flex min-w-0 max-w-full items-center gap-2',
                isEditingTitle
                  ? 'rounded-lg border border-border/60 bg-muted/40 px-2 py-1 shadow-sm'
                  : 'group relative cursor-pointer',
              )}
              onMouseEnter={() => canEdit && !isEditingTitle && setShowPencil(true)}
              onMouseLeave={() => setShowPencil(false)}
              onClick={() => {
                if (canEdit && !isEditingTitle) {
                  handleStartEditing();
                }
              }}
            >
              {isEditingTitle ? (
                <Input
                  ref={titleInputRef}
                  value={tempWorkflowName}
                  onChange={(e) => setTempWorkflowName(e.target.value)}
                  onBlur={handleChangeWorkflowName}
                  onKeyDown={handleKeyDown}
                  className="h-7 min-w-[80px] w-full border-none bg-transparent px-0 py-0 text-xs font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
                  placeholder="Workflow name"
                  maxLength={100}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <h1 className="truncate text-xs font-semibold text-foreground sm:text-sm md:max-w-[280px] lg:max-w-[360px]">
                    {metadata.name || DEFAULT_WORKFLOW_NAME}
                  </h1>
                  {canEdit && (
                    <Pencil
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground transition-opacity sm:h-3.5 sm:w-3.5',
                        showPencil ? 'opacity-100' : 'opacity-50 sm:opacity-0',
                      )}
                    />
                  )}
                </>
              )}
            </div>
            {metadata.currentVersion !== null && metadata.currentVersion !== undefined && (
              <span className="hidden shrink-0 items-center rounded-md border border-border/60 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground lg:inline-flex">
                v{metadata.currentVersion}
              </span>
            )}
          </div>

          <div className="justify-self-center">{modeToggle}</div>

          <div className="flex min-w-0 flex-wrap items-center justify-end justify-self-end gap-1 md:gap-1.5">
            <Button
              onClick={handleRun}
              disabled={!canEdit}
              size="sm"
              aria-label="Run"
              className={cn(TOOLBAR_BUTTON_CLASS, 'gap-1.5')}
            >
              <Play className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Run</span>
            </Button>

            {showOverflowMenu && (
              <>
                {mode === 'design' && onImport && (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json,.yaml,.yml"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={TOOLBAR_ICON_BUTTON_CLASS}
                      aria-label="More options"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {mode === 'design' && (
                      <>
                        <DropdownMenuItem onClick={onUndo} disabled={!canEdit || !canUndo}>
                          <Undo2 className="mr-2 h-4 w-4" />
                          <span>Undo</span>
                          <span className="ml-auto pl-4 text-xs text-muted-foreground">
                            {isMac ? '⌘Z' : 'Ctrl+Z'}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onRedo} disabled={!canEdit || !canRedo}>
                          <Redo2 className="mr-2 h-4 w-4" />
                          <span>Redo</span>
                          <span className="ml-auto pl-4 text-xs text-muted-foreground">
                            {isMac ? '⌘⇧Z' : 'Ctrl+Shift+Z'}
                          </span>
                        </DropdownMenuItem>
                        {(onImport || onExport || showAnalyticsOption) && <DropdownMenuSeparator />}
                      </>
                    )}
                    {showAnalyticsOption && (
                      <DropdownMenuItem
                        onClick={handleViewAnalytics}
                        disabled={!isOrgReady || !hasAnalyticsSink}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        <span>View Analytics</span>
                      </DropdownMenuItem>
                    )}
                    {mode === 'design' && onImport && (
                      <DropdownMenuItem
                        onClick={handleImportClick}
                        disabled={!canEdit || isImporting}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        <span>Import</span>
                      </DropdownMenuItem>
                    )}
                    {mode === 'design' && onExport && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={!canEdit}>
                          <Download className="mr-2 h-4 w-4" />
                          <span>Export</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => onExport('json')}>
                            <span>JSON (.json)</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onExport('yaml')}>
                            <span>YAML (.yaml)</span>
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    {onPublishTemplate && isInWorkflowBuilder && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onPublishTemplate} disabled={!canEdit}>
                          <Package className="mr-2 h-4 w-4" />
                          <span>Publish as Template</span>
                        </DropdownMenuItem>
                      </>
                    )}
                    {mode === 'design' && onToggleVersionHistory && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onToggleVersionHistory}>
                          <History className="mr-2 h-4 w-4" />
                          <span>Version History</span>
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={saveBeforeRunOpen} onOpenChange={setSaveBeforeRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Want to save current state?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Save your workflow before running, or cancel to keep
              editing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => void handleSaveFromDialog(false)}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
            <AlertDialogAction
              disabled={isSaving}
              onClick={(event) => {
                event.preventDefault();
                void handleSaveFromDialog(true);
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save & Run'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
