import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, ExternalLink, Loader2, ShieldCheck, Users } from 'lucide-react';
import { useCommunityTemplateJson } from '@/hooks/queries/useCommunityCatalog';
import type { CommunityCatalogEntry } from '@/schemas/communityCatalog';
import { PreviewSection } from './PreviewSection';
import { toTitleCase } from './types';

export interface CommunityDetailModalProps {
  entry: CommunityCatalogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (entry: CommunityCatalogEntry) => void;
  canImport: boolean;
  isImporting?: boolean;
}

export function CommunityDetailModal({
  entry,
  open,
  onOpenChange,
  onImport,
  canImport,
  isImporting = false,
}: CommunityDetailModalProps) {
  const {
    data: templateJson,
    isLoading,
    error,
  } = useCommunityTemplateJson(open && entry ? entry.templatePath : null);

  if (!entry) return null;

  const graph =
    templateJson && typeof templateJson.graph === 'object' && templateJson.graph !== null
      ? (templateJson.graph as Record<string, unknown>)
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto p-0">
        {isLoading ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading template preview…
          </div>
        ) : error ? (
          <div className="flex h-40 items-center justify-center px-6 text-sm text-destructive">
            {error.message}
          </div>
        ) : (
          <PreviewSection
            graph={graph}
            category={entry.category}
            interactive
            heightClass="h-72 sm:h-80"
            className="rounded-t-lg rounded-b-none"
            showCategoryBadge={false}
          />
        )}

        <div className="space-y-4 px-6 pb-6">
          <DialogHeader>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium">
                <Users className="h-3.5 w-3.5" />
                Community
              </span>
              {entry.reviewed && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Reviewed
                </span>
              )}
            </div>
            <DialogTitle className="text-2xl font-semibold">{toTitleCase(entry.name)}</DialogTitle>
            <DialogDescription className="mt-2 text-sm">{entry.description}</DialogDescription>
            <p className="mt-2 text-sm text-muted-foreground">
              by <span className="font-medium text-foreground">{entry.author.displayName}</span>
              {entry.author.title ? ` · ${entry.author.title}` : ''}
            </p>
          </DialogHeader>

          {(entry.tags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.tags!.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="h-11 flex-1 gap-2 rounded-xl"
              onClick={() => onImport(entry)}
              disabled={!canImport || isImporting}
            >
              <Download className="h-4 w-4" />
              {isImporting ? 'Importing…' : 'Import into workspace'}
            </Button>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" asChild>
              <a href={entry.htmlUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
