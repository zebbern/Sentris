import { useState, useRef, useCallback, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TagBadge } from './TagBadge';
import { cn } from '@/lib/utils';

interface TagEditorProps {
  /** Current tags on the workflow. */
  currentTags: string[];
  /** All available tags (for suggestions). */
  availableTags: string[];
  /** Called with the new complete set of tags. */
  onSave: (tags: string[]) => void;
  /** Whether the mutation is in progress. */
  isPending?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

const MAX_TAG_LENGTH = 100;
const MAX_TAGS_PER_WORKFLOW = 50;

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function TagEditor({
  currentTags,
  availableTags,
  onSave,
  isPending = false,
  className,
}: TagEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync editing tags when popover opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setEditingTags([...currentTags]);
        setInputValue('');
      }
      setIsOpen(open);
    },
    [currentTags],
  );

  // Focus input when popover opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow popover animation to complete
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const addTag = useCallback(
    (raw: string) => {
      const tag = normalizeTag(raw);
      if (
        tag.length === 0 ||
        tag.length > MAX_TAG_LENGTH ||
        editingTags.includes(tag) ||
        editingTags.length >= MAX_TAGS_PER_WORKFLOW
      ) {
        return;
      }
      const nextTags = [...editingTags, tag];
      setEditingTags(nextTags);
      setInputValue('');
      onSave(nextTags);
    },
    [editingTags, onSave],
  );

  const removeTag = useCallback(
    (tag: string) => {
      const nextTags = editingTags.filter((t) => t !== tag);
      setEditingTags(nextTags);
      onSave(nextTags);
    },
    [editingTags, onSave],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    }
    if (e.key === 'Backspace' && inputValue === '' && editingTags.length > 0) {
      removeTag(editingTags[editingTags.length - 1]);
    }
  };

  // Suggestions: available tags not already applied, filtered by input
  const normalizedInput = normalizeTag(inputValue);
  const suggestions = availableTags.filter(
    (t) =>
      !editingTags.includes(t) && (normalizedInput.length === 0 || t.includes(normalizedInput)),
  );

  const showNewTagOption =
    normalizedInput.length > 0 &&
    !editingTags.includes(normalizedInput) &&
    !availableTags.includes(normalizedInput);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 text-muted-foreground hover:text-foreground', className)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Edit tags"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <span className="text-sm font-medium">Edit tags</span>

          {/* Current tags */}
          {editingTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {editingTags.map((tag) => (
                <TagBadge key={tag} tag={tag} isActive onRemove={() => removeTag(tag)} />
              ))}
            </div>
          )}

          {/* Input */}
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a tag name…"
            className="h-8 text-sm"
            maxLength={MAX_TAG_LENGTH}
            disabled={isPending}
            aria-label="Tag name input"
          />

          {/* Suggestions / new tag */}
          {(suggestions.length > 0 || showNewTagOption) && (
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {showNewTagOption && (
                <button
                  type="button"
                  onClick={() => addTag(normalizedInput)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>
                    Create <span className="font-medium">&quot;{normalizedInput}&quot;</span>
                  </span>
                </button>
              )}
              {suggestions.slice(0, 15).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addTag(tag)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          )}

          {editingTags.length >= MAX_TAGS_PER_WORKFLOW && (
            <p className="text-xs text-muted-foreground">
              Maximum of {MAX_TAGS_PER_WORKFLOW} tags reached.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
