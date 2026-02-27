import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Download,
  FileBox,
  RefreshCw,
  Search,
  Copy,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useArtifactLibrary,
  useDownloadArtifact,
  useDeleteArtifact,
} from '@/hooks/queries/useArtifactQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ArtifactMetadata } from '@shipsec/shared';
import { Badge } from '@/components/ui/badge';
import { getRemoteUploads } from '@/utils/artifacts';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useToast } from '@/components/ui/use-toast';
import { humanizeApiError } from '@/lib/humanizeApiError';

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
};

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export function ArtifactLibrary() {
  useDocumentTitle('Artifacts');
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirmDialog();
  const { toast } = useToast();

  const searchFilter = searchQuery.trim() || undefined;
  const {
    data: library = [],
    isLoading: libraryLoading,
    error: libraryQueryError,
  } = useArtifactLibrary(searchFilter ? { search: searchFilter } : undefined);
  const libraryError = libraryQueryError?.message ?? null;

  const downloadArtifactMutation = useDownloadArtifact();
  const deleteArtifactMutation = useDeleteArtifact();
  const [copiedRemoteUri, setCopiedRemoteUri] = useState<string | null>(null);

  const { data: workflowsRaw = [] } = useWorkflowsSummary();
  const workflows: Record<string, string> = {};
  workflowsRaw.forEach((w: any) => {
    if (w.id) workflows[w.id] = w.name;
  });

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.root() });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.root() });
  };

  return (
    <div className="flex-1 bg-background" aria-busy={libraryLoading}>
      <div className="container mx-auto py-4 md:py-8 px-3 md:px-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4 md:mb-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search artifacts..."
                  className="pl-8 w-full sm:w-auto"
                  autoComplete="off"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={libraryLoading}
                className="flex-shrink-0 border border-input"
              >
                Search
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              onClick={handleRefresh}
              disabled={libraryLoading}
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-3 md:mx-0 px-3 md:px-0">
          {libraryLoading ? (
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow className="text-xs uppercase text-muted-foreground">
                  <TableHead className="min-w-[150px]">Name</TableHead>
                  <TableHead className="min-w-[150px] hidden sm:table-cell">Workflow</TableHead>
                  <TableHead className="min-w-[100px] hidden sm:table-cell">Run</TableHead>
                  <TableHead className="min-w-[60px]">Size</TableHead>
                  <TableHead className="min-w-[100px] hidden lg:table-cell">Created</TableHead>
                  <TableHead className="min-w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 4 }).map((_, idx) => (
                  <TableRow key={`skeleton-${idx}`}>
                    <TableCell>
                      <Skeleton className="h-4 w-[130px]" />
                      <Skeleton className="h-3 w-[80px] mt-1" />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Skeleton className="h-4 w-[120px]" />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Skeleton className="h-4 w-[70px]" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-[50px]" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Skeleton className="h-4 w-[100px]" />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Skeleton className="h-8 w-[60px]" />
                        <Skeleton className="h-8 w-[80px]" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : libraryError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load artifacts"
              description={libraryError}
              action={
                <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
                  Try again
                </Button>
              }
            />
          ) : library.length === 0 ? (
            <EmptyState
              icon={FileBox}
              title="No artifacts found"
              description="Run workflows with artifact saving enabled to populate this library."
            />
          ) : (
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow className="text-xs uppercase text-muted-foreground">
                  <TableHead className="min-w-[150px]">Name</TableHead>
                  <TableHead className="min-w-[150px] hidden sm:table-cell">Workflow</TableHead>
                  <TableHead className="min-w-[100px] hidden sm:table-cell">Run</TableHead>
                  <TableHead className="min-w-[60px]">Size</TableHead>
                  <TableHead className="min-w-[100px] hidden lg:table-cell">Created</TableHead>
                  <TableHead className="min-w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {library.map((artifact) => (
                  <ArtifactLibraryRow
                    key={artifact.id}
                    artifact={artifact}
                    workflowName={workflows[artifact.workflowId] || 'Unknown Workflow'}
                    onDownload={async () => {
                      try {
                        await downloadArtifactMutation.mutateAsync({ artifact });
                      } catch (err) {
                        toast({
                          title: 'Download failed',
                          description: humanizeApiError(err),
                          variant: 'destructive',
                        });
                      }
                    }}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: 'Delete artifact',
                        description: 'Are you sure you want to delete this artifact?',
                        confirmLabel: 'Delete',
                      });
                      if (!ok) return;
                      try {
                        await deleteArtifactMutation.mutateAsync(artifact.id);
                      } catch (err) {
                        toast({
                          title: 'Failed to delete artifact',
                          description: humanizeApiError(err),
                          variant: 'destructive',
                        });
                      }
                    }}
                    isDeleting={
                      deleteArtifactMutation.isPending &&
                      deleteArtifactMutation.variables === artifact.id
                    }
                    onCopyRemoteUri={async (uri: string) => {
                      try {
                        await navigator.clipboard.writeText(uri);
                        setCopiedRemoteUri(uri);
                        setTimeout(() => {
                          setCopiedRemoteUri((current) => (current === uri ? null : current));
                        }, 2000);
                      } catch (error) {
                        console.error('Failed to copy remote URI', error);
                      }
                    }}
                    copiedRemoteUri={copiedRemoteUri}
                    isDownloading={downloadArtifactMutation.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <ConfirmDialog {...dialogProps} />
      </div>
    </div>
  );
}

function ArtifactLibraryRow({
  artifact,
  workflowName,
  onDownload,
  onDelete,
  onCopyRemoteUri,
  copiedRemoteUri,
  isDownloading,
  isDeleting,
}: {
  artifact: ArtifactMetadata;
  workflowName: string;
  onDownload: () => void;
  onDelete: () => void;
  onCopyRemoteUri: (uri: string) => void;
  copiedRemoteUri: string | null;
  isDownloading: boolean;
  isDeleting: boolean;
}) {
  const remoteUploads = getRemoteUploads(artifact);

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium truncate max-w-[150px] md:max-w-none">{artifact.name}</div>
        <div className="text-[10px] md:text-xs text-muted-foreground font-mono truncate max-w-[150px] md:max-w-none">
          {artifact.id}
        </div>
        {remoteUploads.length > 0 && (
          <div className="mt-2 space-y-1 hidden md:block">
            {remoteUploads.map((remote) => (
              <div
                key={`${artifact.id}-${remote.uri}`}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <Badge variant="outline" className="text-[10px] uppercase">
                  {remote.type}
                </Badge>
                <code className="max-w-[180px] lg:max-w-[240px] truncate font-mono text-[11px]">
                  {remote.uri}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onCopyRemoteUri(remote.uri)}
                >
                  <Copy className="h-3 w-3" />
                  <span className="hidden lg:inline">
                    {copiedRemoteUri === remote.uri ? 'Copied' : 'Copy URI'}
                  </span>
                </Button>
                {remote.url ? (
                  <a
                    href={remote.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="hidden lg:inline">Open</span>
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top text-xs md:text-sm text-muted-foreground hidden sm:table-cell">
        <span className="truncate max-w-[150px] block" title={workflowName}>
          {workflowName}
        </span>
      </TableCell>
      <TableCell className="align-top text-xs md:text-sm text-primary hidden sm:table-cell">
        <Link to={`/runs/${artifact.runId}`} className="hover:underline font-mono">
          {artifact.runId.substring(0, 8)}…
        </Link>
      </TableCell>
      <TableCell className="align-top text-xs md:text-sm">{formatBytes(artifact.size)}</TableCell>
      <TableCell className="align-top text-xs md:text-sm text-muted-foreground hidden lg:table-cell">
        {formatTimestamp(artifact.createdAt)}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap justify-start gap-1 md:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 md:gap-2 h-8 px-2 md:px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              onDelete();
            }}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden md:inline">{isDeleting ? 'Deleting…' : 'Delete'}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 md:gap-2 h-8 px-2 md:px-3"
            onClick={onDownload}
            disabled={isDownloading}
          >
            <Download className="h-4 w-4" />
            <span className="hidden md:inline">{isDownloading ? 'Downloading…' : 'Download'}</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
