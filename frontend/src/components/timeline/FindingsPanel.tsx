import { useState, useMemo, useCallback } from 'react';
import { Loader2, Download, FileSpreadsheet, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useExecutionNodeIO } from '@/hooks/queries/useExecutionQueries';
import { cn } from '@/lib/utils';
import {
  normalizeAllFindings,
  type Finding,
  type FindingSeverity,
} from '@/utils/normalizeFindings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_BADGE_CLASSES: Record<FindingSeverity, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-blue-400 text-white',
  info: 'bg-gray-400 text-white',
};

const SEVERITY_EMOJI: Record<FindingSeverity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
};

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function escapeCSV(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateCSV(findings: Finding[]): string {
  const header = 'Severity,Type,Finding,Source Node,Source Component';
  const rows = findings.map((f) =>
    [f.severity, f.type, f.finding, f.sourceNode, f.sourceComponent].map(escapeCSV).join(','),
  );
  return [header, ...rows].join('\n');
}

function severityCounts(findings: Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

function generateMarkdown(findings: Finding[], runId: string | null): string {
  const counts = severityCounts(findings);
  const lines: string[] = [
    '# Findings Report',
    '',
    `- **Run**: ${runId ?? 'N/A'}`,
    `- **Date**: ${new Date().toISOString()}`,
    `- **Total Findings**: ${findings.length}`,
    '',
    '## Summary',
    '',
    '| Severity | Count |',
    '|----------|-------|',
    ...SEVERITY_LABELS.map((s) => `| ${s.charAt(0).toUpperCase() + s.slice(1)} | ${counts[s]} |`),
    '',
  ];

  for (const sev of SEVERITY_LABELS) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(
      `## ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${group.length})`,
      '',
      '| Type | Finding | Source |',
      '|------|---------|--------|',
    );
    for (const f of group) {
      lines.push(`| ${f.type} | ${f.finding.replace(/\|/g, '\\|')} | ${f.sourceNode} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FindingsPanelProps {
  runId: string | null;
}

export function FindingsPanel({ runId }: FindingsPanelProps) {
  const { data: rawNodeIOData, isLoading, error: queryError } = useExecutionNodeIO(runId);

  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Normalise all node outputs into flat findings.
  const allFindings = useMemo(() => {
    if (!rawNodeIOData?.nodes) return [];
    const nodes = rawNodeIOData.nodes as {
      nodeRef: string;
      componentId: string;
      outputs: Record<string, unknown> | null;
    }[];
    return normalizeAllFindings(nodes);
  }, [rawNodeIOData]);

  // Unique source nodes for the dropdown.
  const sourceNodes = useMemo(() => {
    const set = new Set<string>();
    for (const f of allFindings) set.add(f.sourceNode);
    return Array.from(set).sort();
  }, [allFindings]);

  // Apply filters.
  const filteredFindings = useMemo(() => {
    let result = allFindings;
    if (severityFilter !== 'all') {
      result = result.filter((f) => f.severity === severityFilter);
    }
    if (sourceFilter !== 'all') {
      result = result.filter((f) => f.sourceNode === sourceFilter);
    }
    return result;
  }, [allFindings, severityFilter, sourceFilter]);

  const counts = useMemo(() => severityCounts(allFindings), [allFindings]);

  const handleExportCSV = useCallback(() => {
    const csv = generateCSV(filteredFindings);
    downloadBlob(csv, `findings-${runId ?? 'unknown'}.csv`, 'text/csv;charset=utf-8;');
  }, [filteredFindings, runId]);

  const handleExportMarkdown = useCallback(() => {
    const md = generateMarkdown(filteredFindings, runId);
    downloadBlob(md, `findings-${runId ?? 'unknown'}.md`, 'text/markdown;charset=utf-8;');
  }, [filteredFindings, runId]);

  // --- State rendering ---

  if (!runId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground p-8">
        Select a run to view findings.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading findings…
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-destructive">
        Failed to load findings: {queryError.message}
      </div>
    );
  }

  if (allFindings.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
        <Search className="h-8 w-8 opacity-40" />
        <span className="text-sm">No findings for this run</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar: filters + export */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 bg-background/70">
        {/* Severity pills */}
        <div className="inline-flex rounded-md border bg-background p-0.5 text-xs gap-0.5 flex-wrap">
          <button
            type="button"
            className={cn(
              'h-6 px-2 rounded text-xs font-medium transition-colors',
              severityFilter === 'all' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
            onClick={() => setSeverityFilter('all')}
          >
            All
            <Badge
              variant="secondary"
              className="ml-1 h-4 min-w-[1.25rem] px-1 text-[10px] leading-none"
            >
              {allFindings.length}
            </Badge>
          </button>
          {SEVERITY_LABELS.map((sev) => (
            <button
              key={sev}
              type="button"
              className={cn(
                'h-6 px-2 rounded text-xs font-medium transition-colors capitalize',
                severityFilter === sev ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
              onClick={() => setSeverityFilter(sev)}
            >
              {sev}
              {counts[sev] > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 min-w-[1.25rem] px-1 text-[10px] leading-none"
                >
                  {counts[sev]}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {/* Source node dropdown */}
        {sourceNodes.length > 1 && (
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-6 rounded border bg-background px-1.5 text-[11px] max-w-[160px]"
            aria-label="Filter by source node"
          >
            <option value="all">All sources</option>
            {sourceNodes.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Export buttons */}
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleExportMarkdown}
          title="Export as Markdown"
        >
          <Download className="h-3 w-3" />
          MD
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          onClick={handleExportCSV}
          title="Export as CSV"
        >
          <FileSpreadsheet className="h-3 w-3" />
          CSV
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-muted/80 z-10">
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-1.5 w-[90px]">Severity</th>
              <th className="px-3 py-1.5 w-[110px]">Type</th>
              <th className="px-3 py-1.5">Finding</th>
              <th className="px-3 py-1.5 w-[130px]">Source</th>
            </tr>
          </thead>
          <tbody>
            {filteredFindings.map((f) => (
              <tr
                key={f.id}
                className="border-b border-border/40 hover:bg-accent/30 transition-colors"
              >
                <td className="px-3 py-1.5">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize',
                      SEVERITY_BADGE_CLASSES[f.severity],
                    )}
                  >
                    {SEVERITY_EMOJI[f.severity]} {f.severity}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground capitalize">{f.type}</td>
                <td className="px-3 py-1.5 break-all font-mono text-[11px]">{f.finding}</td>
                <td className="px-3 py-1.5 text-muted-foreground truncate" title={f.sourceNode}>
                  {f.sourceNode}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredFindings.length === 0 && allFindings.length > 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            No findings match the selected filters.
          </div>
        )}
      </div>

      {/* Footer count */}
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Showing {filteredFindings.length} of {allFindings.length} findings
      </div>
    </div>
  );
}
