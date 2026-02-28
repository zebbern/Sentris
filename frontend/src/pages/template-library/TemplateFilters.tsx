import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, RefreshCw, Search, Tag, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCategoryStyle } from './types';

// ---------------------------------------------------------------------------
// Template filters
// ---------------------------------------------------------------------------

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
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  onSync: () => void;
  isSyncing: boolean;
  canManageWorkflows: boolean;
}

export function TemplateFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  categories,
  tags,
  selectedTags,
  onToggleTag,
  hasFilters,
  onClearFilters,
  onSync,
  isSyncing,
  canManageWorkflows,
}: TemplateFiltersProps) {
  return (
    <div className="mb-6 space-y-3">
      {/* Search + Category + Sync */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 h-9"
          />
        </div>

        <Select value={selectedCategory || 'all'} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
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
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={isSyncing || !canManageWorkflows}
          className="gap-2 h-9"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
          <span className="hidden sm:inline">Sync</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            window.open('https://github.com/shipsec/templates', '_blank', 'noopener,noreferrer')
          }
          className="gap-2 h-9"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contribute</span>
        </Button>
      </div>

      {/* Tags + Clear */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 ml-1">
          <Tag className="h-3.5 w-3.5 text-muted-foreground mr-0.5" />
          {tags.slice(0, 12).map((tag) => (
            <button
              key={tag}
              onClick={() => onToggleTag(tag)}
              className={cn(
                'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
                'border',
                selectedTags.includes(tag)
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted hover:border-border',
              )}
            >
              {tag}
            </button>
          ))}

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFilters}
              className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground ml-1"
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
