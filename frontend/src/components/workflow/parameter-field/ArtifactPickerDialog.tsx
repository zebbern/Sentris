import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Search } from 'lucide-react';
import type { ArtifactMetadata } from '@sentris/shared';

interface ArtifactPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (artifactId: string) => void;
  libraryLoading: boolean;
  libraryError: string | null;
  artifacts: ArtifactMetadata[];
  onRefresh: () => Promise<void>;
}

export function ArtifactPickerDialog({
  open,
  onOpenChange,
  onSelect,
  libraryLoading,
  libraryError,
  artifacts,
  onRefresh,
}: ArtifactPickerDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!open) {
      setSearchTerm('');
    }
  }, [open]);

  const filteredArtifacts = useMemo(() => {
    if (!searchTerm.trim()) {
      return artifacts;
    }
    const term = searchTerm.toLowerCase();
    return artifacts.filter((artifact) => {
      return (
        artifact.name.toLowerCase().includes(term) ||
        artifact.componentRef.toLowerCase().includes(term) ||
        artifact.id.toLowerCase().includes(term)
      );
    });
  }, [artifacts, searchTerm]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Select an artifact</DialogTitle>
          <DialogDescription>
            Choose an artifact from the workspace library. Only artifacts saved to the library are
            listed here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name, component, or ID"
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={libraryLoading}
              onClick={() => void onRefresh()}
            >
              Refresh
            </Button>
          </div>
          {libraryError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {libraryError}
            </div>
          )}
          <div className="max-h-[320px] overflow-auto rounded-md border">
            {libraryLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Loading artifacts…
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No artifacts found. Try refreshing or adjusting your search.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Component</th>
                    <th className="px-3 py-2 font-medium">Destinations</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArtifacts.map((artifact) => (
                    <tr key={artifact.id} className="border-t">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{artifact.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[260px]">
                          {artifact.id}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {artifact.componentRef}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-1">
                          {artifact.destinations.map((destination) => (
                            <Badge
                              key={`${artifact.id}-${destination}`}
                              variant="outline"
                              className="text-[10px] uppercase"
                            >
                              {destination}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Button type="button" size="sm" onClick={() => onSelect(artifact.id)}>
                          Use
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
