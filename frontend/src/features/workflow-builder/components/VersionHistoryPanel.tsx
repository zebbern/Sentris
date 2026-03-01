import { useCallback, useState } from 'react';
import { History, RotateCcw, Check, Loader2, Eye } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkflowVersions } from '@/hooks/queries/useWorkflowQueries';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui/use-toast';
import { formatTimeAgo } from '@/utils/timeFormat';
import { cn } from '@/lib/utils';

interface VersionHistoryPanelProps {
  workflowId: string | undefined;
  onLoadVersion: (graph: {
    nodes: unknown[];
    edges: unknown[];
    viewport?: { x: number; y: number; zoom: number };
  }) => void;
}

export function VersionHistoryPanel({ workflowId, onLoadVersion }: VersionHistoryPanelProps) {
  const { data: versions, isLoading } = useWorkflowVersions(workflowId);
  const metadata = useWorkflowStore((s) => s.metadata);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const versionHistoryPanelOpen = useWorkflowUiStore((s) => s.versionHistoryPanelOpen);
  const setVersionHistoryPanelOpen = useWorkflowUiStore((s) => s.setVersionHistoryPanelOpen);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loadingVersionId, setLoadingVersionId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{
    versionId: string;
    version: number;
  } | null>(null);

  const handleViewVersion = useCallback(
    async (versionId: string) => {
      if (!workflowId) return;

      setLoadingVersionId(versionId);
      try {
        const versionData = await api.workflows.getVersion(workflowId, versionId);
        onLoadVersion({
          nodes: versionData.graph.nodes,
          edges: versionData.graph.edges,
          viewport: versionData.graph.viewport,
        });
        toast({
          title: `Loaded version ${versionData.version}`,
          description: 'The canvas now shows this version. Save to keep changes.',
        });
      } catch {
        toast({
          variant: 'destructive',
          title: 'Failed to load version',
          description: 'Could not fetch the version data. Please try again.',
        });
      } finally {
        setLoadingVersionId(null);
      }
    },
    [workflowId, onLoadVersion, toast],
  );

  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!workflowId) return;

      setLoadingVersionId(versionId);
      try {
        const versionData = await api.workflows.getVersion(workflowId, versionId);
        onLoadVersion({
          nodes: versionData.graph.nodes,
          edges: versionData.graph.edges,
          viewport: versionData.graph.viewport,
        });

        // Invalidate version list cache so it refreshes after the user saves
        await queryClient.invalidateQueries({
          queryKey: queryKeys.workflows.versions(workflowId),
        });

        toast({
          variant: 'success',
          title: `Restored version ${versionData.version}`,
          description: 'Save the workflow to commit this as a new version.',
        });
        setVersionHistoryPanelOpen(false);
      } catch {
        toast({
          variant: 'destructive',
          title: 'Failed to restore version',
          description: 'Could not fetch the version data. Please try again.',
        });
      } finally {
        setLoadingVersionId(null);
        setConfirmRestore(null);
      }
    },
    [workflowId, onLoadVersion, toast, queryClient, setVersionHistoryPanelOpen],
  );

  const handleRestoreClick = useCallback(
    (versionId: string, version: number) => {
      if (isDirty) {
        setConfirmRestore({ versionId, version });
      } else {
        handleRestoreVersion(versionId);
      }
    },
    [isDirty, handleRestoreVersion],
  );

  const sortedVersions = versions ? [...versions].sort((a, b) => b.version - a.version) : [];

  return (
    <>
      <Sheet open={versionHistoryPanelOpen} onOpenChange={setVersionHistoryPanelOpen}>
        <SheetContent side="right" className="w-[360px] sm:w-[400px] p-0 flex flex-col">
          <SheetHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </SheetTitle>
            <SheetDescription>
              View and restore previous versions of this workflow.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {isLoading ? (
              <VersionListSkeleton />
            ) : sortedVersions.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-1">
                {sortedVersions.map((version) => {
                  const isCurrent = version.id === metadata.currentVersionId;
                  const isLoadingThis = loadingVersionId === version.id;

                  return (
                    <div
                      key={version.id}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors',
                        isCurrent
                          ? 'border-primary/30 bg-primary/5'
                          : 'border-transparent hover:border-border hover:bg-muted/50',
                      )}
                    >
                      {/* Version indicator dot */}
                      <div className="flex-shrink-0">
                        <div
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            isCurrent ? 'bg-primary' : 'bg-muted-foreground/30',
                          )}
                        />
                      </div>

                      {/* Version info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">v{version.version}</span>
                          {isCurrent && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-5 border-primary/40 text-primary"
                            >
                              <Check className="h-3 w-3 mr-0.5" />
                              Current
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatTimeAgo(version.createdAt)}
                        </p>
                      </div>

                      {/* Actions */}
                      {!isCurrent && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleViewVersion(version.id)}
                                  disabled={isLoadingThis}
                                  aria-label={`View version ${version.version}`}
                                >
                                  {isLoadingThis ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View on canvas</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => handleRestoreClick(version.id, version.version)}
                                  disabled={isLoadingThis}
                                  aria-label={`Restore version ${version.version}`}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Restore this version</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Unsaved changes confirmation dialog */}
      <AlertDialog
        open={confirmRestore !== null}
        onOpenChange={(open) => !open && setConfirmRestore(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Restoring version{' '}
              <strong>v{confirmRestore?.version}</strong> will replace your current canvas. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmRestore) {
                  handleRestoreVersion(confirmRestore.versionId);
                }
              }}
            >
              Restore anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function VersionListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <History className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground">No versions yet</p>
      <p className="text-xs text-muted-foreground/70 mt-1 max-w-[200px]">
        Versions are created when the workflow is saved and committed.
      </p>
    </div>
  );
}
