import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ExpandableTextProps {
  text: string;
  limit?: number;
  className?: string;
}

export function ExpandableText({ text, limit = 220, className }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = text.length > limit;
  const displayText = expanded || !shouldTruncate ? text : `${text.slice(0, limit)}…`;
  return (
    <div className="space-y-1">
      <p className={cn('whitespace-pre-wrap leading-relaxed', className)}>{displayText}</p>
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="text-[11px] font-semibold text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
