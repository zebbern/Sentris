import { useState, useCallback } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { findingsApi, type FindingsExportParams } from '@/services/api/findings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportButtonProps {
  severity?: string;
  search?: string;
  workflowId?: string;
  componentId?: string;
  dateFrom?: string;
  dateTo?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExportButton({
  severity,
  search,
  workflowId,
  componentId,
  dateFrom,
  dateTo,
  className,
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setIsExporting(true);
      try {
        const params: FindingsExportParams = {
          format,
          severity,
          search,
          workflowId,
          componentId,
          dateFrom,
          dateTo,
        };
        const blob = await findingsApi.exportFindings(params);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `findings-${timestamp}.${format}`;
        triggerBlobDownload(blob, filename);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed';
        toast({ title: 'Export failed', description: message });
      } finally {
        setIsExporting(false);
      }
    },
    [severity, search, workflowId, componentId, dateFrom, dateTo, toast],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExporting} className={cn(className)}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('json')}>Export as JSON</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
