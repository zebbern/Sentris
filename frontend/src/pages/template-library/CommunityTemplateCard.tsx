import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Eye, ShieldCheck, Users } from 'lucide-react';
import type { CommunityCatalogEntry } from '@/schemas/communityCatalog';
import { cn } from '@/lib/utils';
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
  const initials = entry.author.displayName.charAt(0).toUpperCase();
  const setup = setupLabel(entry.stats?.setupLevel);
  const tags = (entry.tags || []).slice(0, 3);

  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl',
        'border border-border bg-card shadow-sm dark:bg-zinc-900',
        'transition-colors duration-200 ease-out',
        'hover:border-border/80 hover:bg-muted/20 dark:hover:border-white/10',
      )}
    >
      <div className="relative h-28 w-full overflow-visible">
        {entry.bannerUrl ? (
          <img src={entry.bannerUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div
            className="h-full w-full bg-gradient-to-br from-sky-600/40 via-emerald-600/25 to-background"
            aria-hidden
          />
        )}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent dark:from-zinc-900" />
        <div className="absolute -bottom-5 left-4 flex items-end gap-2">
          {entry.author.avatarUrl ? (
            <img
              src={entry.author.avatarUrl}
              alt=""
              className="h-12 w-12 rounded-full border-2 border-card object-cover shadow-sm dark:border-zinc-900"
              loading="lazy"
            />
          ) : (
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-card bg-muted text-sm font-semibold text-muted-foreground shadow-sm dark:border-zinc-900">
              {initials}
            </span>
          )}
        </div>
        <div className="absolute right-3 top-3 flex flex-wrap justify-end gap-1.5">
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

      <div className="flex flex-1 flex-col gap-3 p-4 pt-8">
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
          <p className="mt-1 text-xs text-muted-foreground">
            by <span className="font-medium text-foreground/90">{entry.author.displayName}</span>
            {entry.author.title ? (
              <span className="text-muted-foreground"> · {entry.author.title}</span>
            ) : null}
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

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

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
