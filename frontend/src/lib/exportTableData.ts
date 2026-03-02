/**
 * Reusable CSV / JSON table-data export utility.
 *
 * Generates a file from an array of records and triggers a browser download.
 * CSV output follows RFC 4180 (proper quoting of commas, double-quotes, newlines).
 */

export interface ExportColumn {
  /** Object key to read from each row */
  key: string;
  /** Human-readable column header */
  header: string;
}

export interface ExportTableDataOptions<T extends object = Record<string, unknown>> {
  data: readonly T[];
  columns: ExportColumn[];
  /** Base filename (without extension). A date suffix is appended automatically. */
  filename: string;
  format: 'csv' | 'json';
}

// ---------------------------------------------------------------------------
// RFC 4180 CSV helpers
// ---------------------------------------------------------------------------

/** Characters that require the cell to be quoted. */
const CSV_SPECIAL = /[",\r\n]/;

function escapeCsvCell(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (CSV_SPECIAL.test(str)) {
    // Double any existing double-quotes, then wrap in double-quotes.
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(data: readonly Record<string, unknown>[], columns: ExportColumn[]): string {
  const headerRow = columns.map((c) => escapeCsvCell(c.header)).join(',');
  const dataRows = data.map((row) => columns.map((col) => escapeCsvCell(row[col.key])).join(','));
  return [headerRow, ...dataRows].join('\r\n');
}

// ---------------------------------------------------------------------------
// JSON helper
// ---------------------------------------------------------------------------

function buildJson(data: readonly Record<string, unknown>[], columns: ExportColumn[]): string {
  const keys = columns.map((c) => c.key);
  const filtered = data.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const key of keys) {
      obj[key] = row[key];
    }
    return obj;
  });
  return JSON.stringify(filtered, null, 2);
}

// ---------------------------------------------------------------------------
// Browser download trigger
// ---------------------------------------------------------------------------

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  // Clean up
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export table data as a CSV or JSON file download.
 *
 * @example
 * ```ts
 * exportTableData({
 *   data: runs,
 *   columns: [
 *     { key: 'workflowName', header: 'Workflow' },
 *     { key: 'status', header: 'Status' },
 *   ],
 *   filename: 'runs',
 *   format: 'csv',
 * });
 * ```
 */
export function exportTableData<T extends object = Record<string, unknown>>({
  data,
  columns,
  filename,
  format,
}: ExportTableDataOptions<T>): void {
  const rows = data as unknown as readonly Record<string, unknown>[];
  const dateSuffix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ext = format === 'csv' ? 'csv' : 'json';
  const fullFilename = `${filename}-${dateSuffix}.${ext}`;

  if (format === 'csv') {
    const content = buildCsv(rows, columns);
    triggerDownload(content, fullFilename, 'text/csv;charset=utf-8');
  } else {
    const content = buildJson(rows, columns);
    triggerDownload(content, fullFilename, 'application/json;charset=utf-8');
  }
}
