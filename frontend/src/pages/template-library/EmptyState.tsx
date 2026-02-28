import { Layers, Search } from 'lucide-react';

export function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="relative mb-6">
        <div className="h-20 w-20 rounded-2xl bg-muted/50 flex items-center justify-center">
          <Layers className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Search className="h-4 w-4 text-primary/40" />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-2">No templates found</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        {hasFilters
          ? "Try adjusting your filters or search query to find what you're looking for."
          : 'No templates available yet. Sync from GitHub to load templates.'}
      </p>
    </div>
  );
}
