import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { HarHeader } from './types';

interface HeadersTableProps {
  headers: HarHeader[];
  title: string;
}

export function HeadersTable({ headers, title }: HeadersTableProps) {
  const { copy, isCopied } = useCopyToClipboard();

  const handleCopy = async (value: string) => {
    await copy(value, { showToast: false });
  };

  if (headers.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">No {title.toLowerCase()}</div>;
  }

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="space-y-0.5">
        {headers.map((header, idx) => (
          <div
            key={`${header.name}-${idx}`}
            className="group flex items-start gap-2 py-1 px-2 rounded hover:bg-muted/50 text-xs font-mono"
          >
            <span className="text-muted-foreground min-w-[140px] flex-shrink-0 break-all">
              {header.name}:
            </span>
            <span className="text-foreground break-all flex-1">{header.value}</span>
            <button
              onClick={() => handleCopy(header.value)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
            >
              {isCopied(header.value) ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
