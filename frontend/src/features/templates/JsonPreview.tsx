import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, ClipboardCheck, Copy } from 'lucide-react';
import { formatJsonSize } from './publish-template-utils';

interface JsonPreviewProps {
  json: string;
  defaultOpen: boolean;
  onCopy: () => void;
  isCopied: boolean;
}

export function JsonPreview({ json, defaultOpen, onCopy, isCopied }: JsonPreviewProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">Template JSON</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {formatJsonSize(json)}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
        >
          {isCopied ? (
            <>
              <ClipboardCheck className="h-3.5 w-3.5 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>
      {isOpen && (
        <pre className="px-3 py-2 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto bg-muted/10 border-t whitespace-pre text-muted-foreground leading-relaxed">
          {json}
        </pre>
      )}
    </div>
  );
}
