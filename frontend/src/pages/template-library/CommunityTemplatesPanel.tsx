import { useMemo, useState } from 'react';
import { ExternalLink, Layers, Search } from 'lucide-react';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  useCommunityCatalog,
  useImportCommunityTemplate,
} from '@/hooks/queries/useCommunityCatalog';
import {
  COMMUNITY_TEMPLATES_CONTRIBUTE_URL,
  type CommunityCatalogEntry,
} from '@/schemas/communityCatalog';
import type { Template } from '@/types/templates';
import { CommunityTemplateCard } from './CommunityTemplateCard';
import { CommunityDetailModal } from './CommunityDetailModal';
import { CardSkeleton } from './TemplateCard';

export interface CommunityTemplatesPanelProps {
  canImport: boolean;
  onImported: (template: Template) => void;
}

export function CommunityTemplatesPanel({ canImport, onImported }: CommunityTemplatesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewEntry, setPreviewEntry] = useState<CommunityCatalogEntry | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useCommunityCatalog();
  const importMutation = useImportCommunityTemplate();

  const templates = data?.templates ?? [];
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((entry) => {
      const haystack = [
        entry.name,
        entry.description,
        entry.category,
        entry.author.displayName,
        ...(entry.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [templates, searchQuery]);

  const handleImport = async (entry: CommunityCatalogEntry) => {
    if (!canImport) return;
    setImportingId(entry.id);
    try {
      const imported = await importMutation.mutateAsync({ id: entry.id });
      setPreviewEntry(null);
      onImported(imported);
    } catch {
      // Global MutationCache error handler shows the toast
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search community templates"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-10"
            aria-label="Search community templates"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() =>
            window.open(COMMUNITY_TEMPLATES_CONTRIBUTE_URL, '_blank', 'noopener,noreferrer')
          }
          aria-label="Contribute community templates"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contribute</span>
        </Button>
      </div>

      {error && (
        <div className="mb-6 space-y-2">
          <ErrorBanner message={error.message} onRetry={() => refetch()} />
          <p className="text-sm text-muted-foreground">
            The Official tab is unaffected.{' '}
            <a
              href={COMMUNITY_TEMPLATES_CONTRIBUTE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Browse the catalog on GitHub
            </a>
            .
          </p>
        </div>
      )}

      {isLoading && !error ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error && filtered.length === 0 ? null : filtered.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={templates.length === 0 ? 'No community templates yet' : 'No matching templates'}
          description={
            templates.length === 0
              ? 'Community templates appear here after a PR is merged to main. Contribute one to get started.'
              : 'Try a different search query.'
          }
          action={
            templates.length === 0 ? (
              <Button variant="outline" asChild>
                <a
                  href={COMMUNITY_TEMPLATES_CONTRIBUTE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Contribute on GitHub
                </a>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setSearchQuery('')}>
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          role="region"
          aria-label="Community template list"
        >
          {filtered.map((entry) => (
            <CommunityTemplateCard
              key={entry.id}
              entry={entry}
              onPreview={setPreviewEntry}
              onImport={handleImport}
              canImport={canImport}
              isImporting={importingId === entry.id}
            />
          ))}
        </div>
      )}

      <CommunityDetailModal
        entry={previewEntry}
        open={!!previewEntry}
        onOpenChange={(open) => {
          if (!open) setPreviewEntry(null);
        }}
        onImport={handleImport}
        canImport={canImport}
        isImporting={previewEntry ? importingId === previewEntry.id : false}
      />
    </div>
  );
}
