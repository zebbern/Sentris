import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useArtifactLibrary } from '@/hooks/queries/useArtifactQueries';
import type { ArtifactMetadata } from '@shipsec/shared';
import { ArtifactPickerDialog } from './ArtifactPickerDialog';

interface ArtifactSelectorProps {
  parameterId: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}

export function ArtifactSelector({ parameterId, value, onChange }: ArtifactSelectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    data: library = [],
    isLoading: libraryLoading,
    error: libraryQueryError,
  } = useArtifactLibrary();
  const libraryError = libraryQueryError?.message ?? null;

  const knownArtifacts = useMemo(() => {
    const map = new Map<string, ArtifactMetadata>();
    for (const artifact of library) {
      map.set(artifact.id, artifact);
    }
    return map;
  }, [library]);

  const selectedArtifact = value ? (knownArtifacts.get(value) ?? null) : null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {selectedArtifact ? (
          <span>
            Selected artifact:{' '}
            <span className="font-medium text-foreground">{selectedArtifact.name}</span>{' '}
            <span className="font-mono text-[11px] text-muted-foreground">
              ({selectedArtifact.id})
            </span>
          </span>
        ) : value ? (
          <span>
            Artifact ID:{' '}
            <span className="font-mono text-[11px] text-muted-foreground">{value}</span> (not in
            cached list)
          </span>
        ) : (
          'No artifact selected.'
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={parameterId}
          type="text"
          value={value || ''}
          onChange={(e) => {
            const nextValue = e.target.value.trim();
            onChange(nextValue.length > 0 ? nextValue : undefined);
          }}
          placeholder="Artifact ID (e.g. 123e4567-e89b-12d3-a456-426614174000)"
          className="text-sm"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setPickerOpen(true)}
          >
            Browse…
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              className="flex-1 sm:flex-none"
              onClick={() => onChange(undefined)}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      <ArtifactPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(artifactId) => {
          onChange(artifactId);
          setPickerOpen(false);
        }}
        libraryLoading={libraryLoading}
        libraryError={libraryError}
        artifacts={library}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['artifactLibrary'] })}
      />
    </div>
  );
}
