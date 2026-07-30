import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Eye, ShieldCheck, Users } from 'lucide-react';
import { useCommunityTemplateJson } from '@/hooks/queries/useCommunityCatalog';
import type { CommunityCatalogEntry } from '@/schemas/communityCatalog';
import { cn } from '@/lib/utils';
import { PreviewSection } from './PreviewSection';
import { toTitleCase } from './types';

export interface CommunityTemplateCardProps {
  entry: CommunityCatalogEntry;
  onPreview: (entry: CommunityCatalogEntry) => void;
  onImport: (entry: CommunityCatalogEntry) => void;
  canImport: boolean;
  isImporting?: boolean;
}

function setupLabel(setupLevel?: 'no-setup' | 'needs-secrets' | 'needs-tools'): string | null {
  switch (setupLevel) {
    case 'no-setup':
      return 'No setup required';
    case 'needs-secrets':
      return 'Needs secrets';
    case 'needs-tools':
      return 'Needs tools';
    case undefined:
      return null;
    default: {
      const _exhaustive: never = setupLevel;
      return _exhaustive;
    }
  }
}

export function CommunityTemplateCard({
  entry,
  onPreview,
  onImport,
  canImport,
  isImporting = false,
}: CommunityTemplateCardProps) {
  const { data: templateJson } = useCommunityTemplateJson(entry.templatePath);
  const graph =
    templateJson && typeof templateJson.graph === 'object' && templateJson.graph !== null
      ? (templateJson.graph as Record<string, unknown>)
      : undefined;
  const initials = entry.author.displayName.charAt(0).toUpperCase();
  const setup = setupLabel(entry.stats?.setupLevel);

  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl',
        'border border-border bg-card shadow-sm dark:bg-zinc-900',
        'transition-colors duration-200 ease-out',
        'hover:border-border/80 hover:bg-muted/20 dark:hover:border-white/10',
      )}
    >
      <div className="relative">
        <PreviewSection
          graph={graph}
          category={entry.category}
          onPreviewClick={() => onPreview(entry)}
          interactive={false}
          heightClass="h-44"
          className="rounded-none"
        />
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-wrap justify-end gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
            <Users className="h-3 w-3" />
            Community
          </span>
          {entry.reviewed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-3 w-3" />
              Reviewed
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-lg font-semibold leading-tight tracking-tight">
            <button
              type="button"
              aria-label={`Preview ${toTitleCase(entry.name)} community template`}
              onClick={() => onPreview(entry)}
              className="line-clamp-1 text-left text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title={entry.name}
            >
              {toTitleCase(entry.name)}
            </button>
          </h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {entry.author.avatarUrl ? (
              <img
                src={entry.author.avatarUrl}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {initials}
              </span>
            )}
            <span>
              by <span className="font-medium text-foreground/90">{entry.author.displayName}</span>
              {entry.author.title ? (
                <span className="text-muted-foreground"> · {entry.author.title}</span>
              ) : null}
            </span>
          </p>
          <p
            className="mt-1.5 line-clamp-2 text-sm text-muted-foreground"
            title={entry.description}
          >
            {entry.description}
          </p>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {typeof entry.stats?.nodeCount === 'number' && <span>{entry.stats.nodeCount} nodes</span>}
          {setup && <span>{setup}</span>}
          {entry.category && <span className="capitalize">{entry.category}</span>}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full px-3"
            onClick={() => onPreview(entry)}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3"
            onClick={() => onImport(entry)}
            disabled={!canImport || isImporting}
          >
            <Download className="h-3.5 w-3.5" />
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground"
            asChild
          >
            <a href={entry.htmlUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}
