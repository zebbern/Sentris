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
  scopeId?: string;
  triageStatus?: string;
  assigneeUserId?: string;
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
  scopeId,
  triageStatus,
  assigneeUserId,
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
          scopeId,
          triageStatus,
          assigneeUserId,
        };
        const result = await findingsApi.exportFindings(params);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `findings-${timestamp}.${format}`;
        triggerBlobDownload(result.blob, filename);
        if (result.availability === 'degraded') {
          const schemaDescription = result.schemaCoverage
            ? ` Schema coverage: ${result.schemaCoverage.canonical} canonical, ${result.schemaCoverage.legacy} legacy, ${result.schemaCoverage.invalid} invalid.`
            : '';
          const projectionDescription = result.projectionHealthReason
            ? ` Projection: ${result.projectionHealthReason.replace(/_/g, ' ')}.`
            : '';
          toast({
            title: 'Export completed with degraded data',
            description: `The file was downloaded, but some results may be stale or malformed.${projectionDescription}${schemaDescription}`,
          });
        } else if (result.availability === 'unknown') {
          toast({
            title: 'Export data quality unknown',
            description:
              'The file was downloaded, but its freshness and schema coverage metadata were not available.',
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed';
        toast({ title: 'Export failed', description: message });
      } finally {
        setIsExporting(false);
      }
    },
    [
      severity,
      search,
      workflowId,
      componentId,
      dateFrom,
      dateTo,
      scopeId,
      triageStatus,
      assigneeUserId,
      toast,
    ],
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
