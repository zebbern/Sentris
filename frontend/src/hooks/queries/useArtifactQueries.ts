import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import type { ArtifactMetadata } from '@sentris/shared';
import { api, type ArtifactListFilters } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';
import { terminalStaleTime } from '@/hooks/queries/useRunQueries';

export const INLINE_ARTIFACT_PREVIEW_MAX_BYTES = 256 * 1024;

export type ArtifactPreviewEligibility = 'previewable' | 'too-large' | 'unsupported';

export type ArtifactPreview = { status: 'ready'; content: string } | { status: 'too-large' };

const normalizeMimeType = (mimeType: string) => mimeType.toLowerCase().split(';', 1)[0].trim();

const isJsonMimeType = (mimeType: string) => {
  const normalized = normalizeMimeType(mimeType);
  return normalized === 'application/json' || normalized.endsWith('+json');
};

export function getArtifactPreviewEligibility(
  artifact: ArtifactMetadata,
): ArtifactPreviewEligibility {
  if (artifact.size > INLINE_ARTIFACT_PREVIEW_MAX_BYTES) return 'too-large';

  const mimeType = normalizeMimeType(artifact.mimeType);
  if (mimeType.startsWith('text/') || isJsonMimeType(mimeType)) return 'previewable';
  return 'unsupported';
}

export async function decodeArtifactPreview(
  artifact: ArtifactMetadata,
  blob: Blob,
): Promise<ArtifactPreview> {
  if (blob.size > INLINE_ARTIFACT_PREVIEW_MAX_BYTES) return { status: 'too-large' };

  const rawContent = await blob.text();
  if (!isJsonMimeType(artifact.mimeType)) {
    return { status: 'ready', content: rawContent };
  }

  try {
    return {
      status: 'ready',
      content: JSON.stringify(JSON.parse(rawContent), null, 2),
    };
  } catch {
    return { status: 'ready', content: rawContent };
  }
}

export function useRunArtifacts(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifacts.byRun(runId ?? ''),
    queryFn: runId
      ? async () => {
          const response = await api.executions.getArtifacts(runId);
          return response.artifacts ?? [];
        }
      : skipToken,
    staleTime: terminalStaleTime(runId ?? null, 30_000),
  });
}

export function useArtifactPreview(
  runId: string | undefined,
  artifact: ArtifactMetadata | undefined,
) {
  const canPreview =
    Boolean(runId && artifact) &&
    getArtifactPreviewEligibility(artifact as ArtifactMetadata) === 'previewable';

  return useQuery({
    queryKey: queryKeys.artifacts.preview(runId ?? '', artifact?.id ?? ''),
    queryFn:
      canPreview && runId && artifact
        ? async () => {
            const blob = await api.executions.downloadArtifact(runId, artifact.id);
            return decodeArtifactPreview(artifact, blob);
          }
        : skipToken,
    staleTime: Infinity,
  });
}

export function useArtifactLibrary(filters?: ArtifactListFilters) {
  return useQuery({
    queryKey: queryKeys.artifacts.library(filters as Record<string, unknown>),
    queryFn: async () => {
      const response = await api.artifacts.list(filters);
      return (response.artifacts ?? []) as ArtifactMetadata[];
    },
    staleTime: 30_000,
  });
}

export function useDownloadArtifact() {
  return useMutation({
    mutationFn: async ({ artifact, runId }: { artifact: ArtifactMetadata; runId?: string }) => {
      const blob = runId
        ? await api.executions.downloadArtifact(runId, artifact.id)
        : await api.artifacts.download(artifact.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = artifact.name || `artifact-${artifact.id}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    },
  });
}

export function useDeleteArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) => api.artifacts.delete(artifactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.artifacts.root() });
    },
  });
}
