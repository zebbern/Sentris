import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Deterministic color mapping for tag badges.
 * Uses hue rotation derived from the tag name for visual distinction.
 */
const TAG_COLORS = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25',
  'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/25',
  'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25',
  'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/25',
  'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/25',
  'bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/25',
  'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/25',
] as const;

function getTagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

interface TagBadgeProps {
  /** Tag name to display. */
  tag: string;
  /** Whether the tag is currently active (filled style). */
  isActive?: boolean;
  /** Called when the tag is clicked. */
  onClick?: () => void;
  /** Called when the remove button is clicked. Renders the X icon when provided. */
  onRemove?: () => void;
  /** Optional count to show beside the tag name. */
  count?: number;
  /** Additional CSS classes. */
  className?: string;
}

export function TagBadge({
  tag,
  isActive = false,
  onClick,
  onRemove,
  count,
  className,
}: TagBadgeProps) {
  const colorClass = getTagColor(tag);
  const isInteractive = Boolean(onClick);

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 text-xs font-medium transition-all',
        isActive ? colorClass : 'bg-transparent text-muted-foreground border-border',
        isInteractive && 'cursor-pointer hover:opacity-80',
        className,
      )}
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {tag}
      {count !== undefined && <span className="text-[10px] opacity-70">({count})</span>}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10 focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={`Remove tag ${tag}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
