import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, RefreshCw, Search, X, ExternalLink, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCategoryStyle } from './types';

interface TemplateCategoryInfo {
  category: string;
  count: number;
}

export interface TemplateFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (category: string) => void;
  categories: TemplateCategoryInfo[];
  hasFilters: boolean;
  onClearFilters: () => void;
  onSync: () => void;
  isSyncing: boolean;
  canManageWorkflows: boolean;
  noSetupOnly: boolean;
  onToggleNoSetupOnly: () => void;
  /** Browse/contribute URL for the official template GitHub repository. */
  contributeUrl: string;
}

export function TemplateFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  hasFilters,
  onClearFilters,
  onSync,
  isSyncing,
  canManageWorkflows,
  noSetupOnly,
  onToggleNoSetupOnly,
  contributeUrl,
}: TemplateFiltersProps) {
  return (
    <div className="mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by template name"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 pl-10"
            aria-label="Filter templates by name"
          />
        </div>

        <Select value={selectedCategory || 'all'} onValueChange={onCategoryChange}>
          <SelectTrigger className="h-9 w-full sm:w-[180px]" aria-label="Filter by category">
            <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => {
              const style = getCategoryStyle(cat.category);
              const CatIcon = style.icon;
              return (
                <SelectItem
                  key={cat.category || 'uncategorized'}
                  value={cat.category || 'uncategorized'}
                >
                  <span className="flex items-center gap-2">
                    <CatIcon className={cn('h-3.5 w-3.5', style.accent)} />
                    {cat.category || 'Uncategorized'} ({cat.count})
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={noSetupOnly ? 'secondary' : 'outline'}
          size="sm"
          onClick={onToggleNoSetupOnly}
          aria-pressed={noSetupOnly}
          title="Runs with only outbound internet — no API keys or Docker images required. You may still enter a target in the run dialog."
          className={cn(
            'h-9 gap-2',
            noSetupOnly &&
              'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300',
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          No setup
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={isSyncing || !canManageWorkflows}
          className="h-9 gap-2"
          aria-label="Sync templates"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(contributeUrl, '_blank', 'noopener,noreferrer')}
          className="h-9 gap-2"
          aria-label="Contribute templates"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contribute</span>
        </Button>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-9 gap-1 px-2.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
