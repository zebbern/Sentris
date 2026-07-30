import { Fragment, useCallback, useMemo, useState } from 'react';
import { Download, RefreshCw, Copy, ExternalLink, Eye, EyeOff } from 'lucide-react';
import type { ArtifactMetadata } from '@sentris/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  getArtifactPreviewEligibility,
  useArtifactPreview,
  useDownloadArtifact,
  useRunArtifacts,
} from '@/hooks/queries/useArtifactQueries';
import { queryKeys } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getRemoteUploads } from '@/utils/artifacts';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

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
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
};

interface RunArtifactsPanelProps {
  runId: string | null;
}

export function RunArtifactsPanel({ runId }: RunArtifactsPanelProps) {
  const queryClient = useQueryClient();
  const [previewSelection, setPreviewSelection] = useState<{
    runId: string;
    artifactId: string | null;
  } | null>(null);
  const {
    data: artifacts = [],
    isLoading: isLoadingArtifacts,
    error,
  } = useRunArtifacts(runId ?? undefined);
  const downloadArtifactMutation = useDownloadArtifact();
  const { copy, isCopied } = useCopyToClipboard();

  const defaultPreviewArtifact = useMemo(
    () => artifacts.find((artifact) => getArtifactPreviewEligibility(artifact) === 'previewable'),
    [artifacts],
  );
  const selectedPreviewId =
    previewSelection?.runId === runId
      ? previewSelection.artifactId
      : (defaultPreviewArtifact?.id ?? null);
  const selectedPreviewArtifact = artifacts.find((artifact) => artifact.id === selectedPreviewId);
  const previewQuery = useArtifactPreview(runId ?? undefined, selectedPreviewArtifact);

  const handleRefresh = useCallback(() => {
    if (runId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.artifacts.byRun(runId) });
    }
  }, [runId, queryClient]);

  const handlePreviewToggle = useCallback(
    (artifactId: string) => {
      if (!runId) return;
      setPreviewSelection({
        runId,
        artifactId: selectedPreviewId === artifactId ? null : artifactId,
      });
    },
    [runId, selectedPreviewId],
  );

  const content = useMemo(() => {
    if (!runId) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a run to view its artifacts.
        </div>
      );
    }

    if (isLoadingArtifacts) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading artifacts…
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-destructive">
          <span>{error instanceof Error ? error.message : String(error)}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      );
    }

    if (artifacts.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No artifacts were saved for this run.
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Component</th>
              <th className="px-4 py-2 font-medium">Size</th>
              <th className="px-4 py-2 font-medium">Created</th>
              <th className="px-4 py-2 font-medium sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((artifact: ArtifactMetadata) => {
              const isPreviewOpen = selectedPreviewArtifact?.id === artifact.id;
              return (
                <Fragment key={artifact.id}>
                  <ArtifactRow
                    artifact={artifact}
                    isPreviewOpen={isPreviewOpen}
                    onPreviewToggle={() => handlePreviewToggle(artifact.id)}
                    onDownload={() =>
                      downloadArtifactMutation.mutate({ artifact, runId: runId ?? undefined })
                    }
                    onCopyRemoteUri={async (uri: string) => {
                      await copy(uri, { showToast: false });
                    }}
                    copiedRemoteUri={isCopied}
                    isDownloading={
                      downloadArtifactMutation.isPending &&
                      downloadArtifactMutation.variables?.artifact.id === artifact.id
                    }
                  />
                  {isPreviewOpen ? (
                    <ArtifactPreviewRow
                      artifact={artifact}
                      data={previewQuery.data}
                      isLoading={previewQuery.isLoading}
                      error={previewQuery.error}
                      onRetry={() => {
                        void previewQuery.refetch();
                      }}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [
    runId,
    artifacts,
    isLoadingArtifacts,
    error,
    handleRefresh,
    downloadArtifactMutation,
    isCopied,
    copy,
    handlePreviewToggle,
    previewQuery.data,
    previewQuery.error,
    previewQuery.isLoading,
    previewQuery.refetch,
    selectedPreviewArtifact,
  ]);

  const handleDownloadAll = () => {
    if (!artifacts.length) return;
    artifacts.forEach((artifact: ArtifactMetadata) => {
      downloadArtifactMutation.mutate({ artifact, runId: runId ?? undefined });
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-background/70 px-4 py-2">
        <div>
          <p className="text-sm font-semibold">Run artifacts</p>
          <p className="text-xs text-muted-foreground">
            Files saved by components during this workflow run.
          </p>
        </div>
        {runId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoadingArtifacts}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        ) : null}
        {artifacts.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadAll}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Download All
          </Button>
        )}
      </div>
      {content}
    </div>
  );
}

function ArtifactRow({
  artifact,
  onDownload,
  onCopyRemoteUri,
  copiedRemoteUri,
  isDownloading,
  isPreviewOpen,
  onPreviewToggle,
}: {
  artifact: ArtifactMetadata;
  onDownload: () => void;
  onCopyRemoteUri: (uri: string) => void;
  copiedRemoteUri: (text: string) => boolean;
  isDownloading: boolean;
  isPreviewOpen: boolean;
  onPreviewToggle: () => void;
}) {
  const remoteUploads = getRemoteUploads(artifact);
  const previewEligibility = getArtifactPreviewEligibility(artifact);

  return (
    <tr className="border-b last:border-none">
      <td className="px-4 py-3 align-top">
        <div className="font-medium">{artifact.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{artifact.id}</div>
        {previewEligibility === 'unsupported' ? (
          <div className="mt-1 text-xs text-muted-foreground">Preview unavailable</div>
        ) : null}
        {previewEligibility === 'too-large' ? (
          <div className="mt-1 text-xs text-muted-foreground">Too large to preview</div>
        ) : null}
        {remoteUploads.length > 0 && (
          <div className="mt-2 space-y-1">
            {remoteUploads.map((remote) => (
              <div
                key={`${artifact.id}-${remote.uri}`}
                className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <Badge variant="outline" className="text-[10px] uppercase">
                  {remote.type}
                </Badge>
                <code className="max-w-[200px] truncate font-mono text-[11px]">{remote.uri}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onCopyRemoteUri(remote.uri)}
                >
                  <Copy className="h-3 w-3" />
                  {copiedRemoteUri(remote.uri) ? 'Copied' : 'Copy URI'}
                </Button>
                {remote.url ? (
                  <a
                    href={remote.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top text-sm text-muted-foreground">{artifact.componentRef}</td>
      <td className="px-4 py-3 align-top text-sm">{formatBytes(artifact.size)}</td>
      <td className="px-4 py-3 align-top text-sm text-muted-foreground">
        {formatTimestamp(artifact.createdAt)}
      </td>
      <td className="px-4 py-3 align-top text-right overflow-x-auto">
        <div className="flex flex-wrap justify-end gap-2">
          {previewEligibility === 'previewable' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onPreviewToggle}
              aria-expanded={isPreviewOpen}
              aria-label={`${isPreviewOpen ? 'Hide' : 'View'} ${artifact.name}`}
              className="gap-2"
            >
              {isPreviewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {isPreviewOpen ? 'Hide' : 'View'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDownload}
            disabled={isDownloading}
            aria-label={`Download ${artifact.name}`}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ArtifactPreviewRow({
  artifact,
  data,
  isLoading,
  error,
  onRetry,
}: {
  artifact: ArtifactMetadata;
  data: { status: 'ready'; content: string } | { status: 'too-large' } | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <tr className="border-b bg-muted/20">
      <td colSpan={5} className="px-4 pb-4 pt-1">
        <div
          role="region"
          aria-label={`Preview of ${artifact.name}`}
          aria-busy={isLoading}
          className="overflow-hidden rounded-md border bg-background"
        >
          <div className="border-b px-3 py-2 text-xs font-medium">Result preview</div>
          {isLoading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Loading preview…</div>
          ) : error ? (
            <div role="alert" className="flex items-center justify-between gap-3 px-3 py-4">
              <span className="text-sm text-destructive">
                {error.message || 'Preview could not be loaded'}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Retry preview
              </Button>
            </div>
          ) : data?.status === 'too-large' ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              The downloaded artifact is too large to preview. Download it to view the full result.
            </div>
          ) : data?.status === 'ready' ? (
            data.content ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-relaxed">
                {data.content}
              </pre>
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">This artifact is empty.</div>
            )
          ) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              Preview unavailable. Download the artifact to view it.
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
