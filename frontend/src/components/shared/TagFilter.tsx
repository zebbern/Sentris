import { Tags, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TagBadge } from './TagBadge';
import { cn } from '@/lib/utils';

interface TagInfo {
  name: string;
  count: number;
}

interface TagFilterProps {
  /** All available tags with counts. */
  availableTags: TagInfo[];
  /** Currently selected tag names. */
  selectedTags: string[];
  /** Called when the selected tags change. */
  onSelectedTagsChange: (tags: string[]) => void;
  /** Whether tags are loading. */
  isLoading?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

export function TagFilter({
  availableTags,
  selectedTags,
  onSelectedTagsChange,
  isLoading = false,
  className,
}: TagFilterProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onSelectedTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onSelectedTagsChange([...selectedTags, tag]);
    }
  };

  const clearAllTags = () => {
    onSelectedTagsChange([]);
  };

  const hasSelectedTags = selectedTags.length > 0;

  if (isLoading || availableTags.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant={hasSelectedTags ? 'secondary' : 'outline'} size="sm" className="gap-1.5">
            <Tags className="h-3.5 w-3.5" />
            Tags
            {hasSelectedTags && (
              <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {selectedTags.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filter by tags</span>
              {hasSelectedTags && (
                <button
                  type="button"
                  onClick={clearAllTags}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tagInfo) => (
                <TagBadge
                  key={tagInfo.name}
                  tag={tagInfo.name}
                  count={tagInfo.count}
                  isActive={selectedTags.includes(tagInfo.name)}
                  onClick={() => toggleTag(tagInfo.name)}
                />
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected tag chips displayed inline (outside popover) */}
      {hasSelectedTags && (
        <>
          <div className="flex flex-wrap gap-1">
            {selectedTags.map((tag) => (
              <TagBadge key={tag} tag={tag} isActive onRemove={() => toggleTag(tag)} />
            ))}
          </div>
          <button
            type="button"
            onClick={clearAllTags}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
            aria-label="Clear all tag filters"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
