import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { exportTableData, type ExportColumn } from '../exportTableData';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
  { key: 'count', header: 'Count' },
];

const SAMPLE_DATA = [
  { name: 'Alpha', status: 'active', count: 10 },
  { name: 'Beta', status: 'inactive', count: 0 },
];

// ---------------------------------------------------------------------------
// DOM mocks — capture Blob + anchor per test
// ---------------------------------------------------------------------------

let lastBlob: Blob | null = null;
let lastDownloadName = '';
let clickCount = 0;
let revokedUrl = '';
let origCreateObjectURL: typeof URL.createObjectURL;
let origRevokeObjectURL: typeof URL.revokeObjectURL;
let origAppendChild: typeof document.body.appendChild;
let origRemoveChild: typeof document.body.removeChild;

beforeEach(() => {
  lastBlob = null;
  lastDownloadName = '';
  clickCount = 0;
  revokedUrl = '';

  origCreateObjectURL = URL.createObjectURL;
  origRevokeObjectURL = URL.revokeObjectURL;
  origAppendChild = document.body.appendChild.bind(document.body);
  origRemoveChild = document.body.removeChild.bind(document.body);

  URL.createObjectURL = (obj: Blob | MediaSource): string => {
    lastBlob = obj as Blob;
    return 'blob:mock-url';
  };

  URL.revokeObjectURL = (url: string): void => {
    revokedUrl = url;
  };

  document.body.appendChild = <T extends Node>(node: T): T => {
    if (node instanceof HTMLAnchorElement) {
      lastDownloadName = node.download;
      node.click = () => {
        clickCount++;
      };
    }
    return node;
  };

  document.body.removeChild = <T extends Node>(node: T): T => node;
});

afterEach(() => {
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
  document.body.appendChild = origAppendChild;
  document.body.removeChild = origRemoveChild;
});

// ---------------------------------------------------------------------------
// CSV tests
// ---------------------------------------------------------------------------

describe('exportTableData — CSV', () => {
  it('generates a CSV Blob with correct MIME type', () => {
    exportTableData({ data: SAMPLE_DATA, columns: COLUMNS, filename: 'test', format: 'csv' });

    expect(lastBlob).toBeInstanceOf(Blob);
    expect(lastBlob!.type).toBe('text/csv;charset=utf-8');
  });

  it('uses the correct filename with date suffix and .csv extension', () => {
    exportTableData({ data: SAMPLE_DATA, columns: COLUMNS, filename: 'runs', format: 'csv' });

    expect(lastDownloadName).toMatch(/^runs-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('clicks the anchor and revokes the object URL', () => {
    exportTableData({ data: SAMPLE_DATA, columns: COLUMNS, filename: 'x', format: 'csv' });

    expect(clickCount).toBe(1);
    expect(revokedUrl).toBe('blob:mock-url');
  });

  it('produces correct CSV content with header and data rows', async () => {
    exportTableData({ data: SAMPLE_DATA, columns: COLUMNS, filename: 'content', format: 'csv' });

    const text = await lastBlob!.text();
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Name,Status,Count');
    expect(lines[1]).toBe('Alpha,active,10');
    expect(lines[2]).toBe('Beta,inactive,0');
  });

  it('escapes values containing commas', async () => {
    const data = [{ name: 'Hello, World', status: 'ok', count: 1 }];
    exportTableData({ data, columns: COLUMNS, filename: 'esc', format: 'csv' });

    const text = await lastBlob!.text();
    const lines = text.split('\r\n');
    expect(lines[1]).toBe('"Hello, World",ok,1');
  });

  it('escapes values containing double quotes', async () => {
    const data = [{ name: 'Say "hi"', status: 'ok', count: 1 }];
    exportTableData({ data, columns: COLUMNS, filename: 'esc', format: 'csv' });

    const text = await lastBlob!.text();
    const lines = text.split('\r\n');
    expect(lines[1]).toBe('"Say ""hi""",ok,1');
  });

  it('escapes values containing newlines', async () => {
    const data = [{ name: 'Line1\nLine2', status: 'ok', count: 1 }];
    exportTableData({ data, columns: COLUMNS, filename: 'esc', format: 'csv' });

    const text = await lastBlob!.text();
    expect(text).toContain('"Line1\nLine2"');
  });

  it('handles null and undefined values gracefully', async () => {
    const data = [{ name: null, status: undefined, count: 0 }];
    exportTableData({
      data: data as unknown as Record<string, unknown>[],
      columns: COLUMNS,
      filename: 'nulls',
      format: 'csv',
    });

    const text = await lastBlob!.text();
    const lines = text.split('\r\n');
    expect(lines[1]).toBe(',,0');
  });

  it('handles empty data array (header only)', async () => {
    exportTableData({ data: [], columns: COLUMNS, filename: 'empty', format: 'csv' });

    const text = await lastBlob!.text();
    expect(text).toBe('Name,Status,Count');
  });
});

// ---------------------------------------------------------------------------
// JSON tests
// ---------------------------------------------------------------------------

describe('exportTableData — JSON', () => {
  it('generates a JSON Blob with correct MIME type', () => {
    exportTableData({ data: SAMPLE_DATA, columns: COLUMNS, filename: 'test', format: 'json' });

    expect(lastBlob).toBeInstanceOf(Blob);
    expect(lastBlob!.type).toBe('application/json;charset=utf-8');
  });

  it('uses the correct filename with date suffix and .json extension', () => {
    exportTableData({
      data: SAMPLE_DATA,
      columns: COLUMNS,
      filename: 'workflows',
      format: 'json',
    });

    expect(lastDownloadName).toMatch(/^workflows-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('includes only specified column keys in JSON output', async () => {
    const data = [{ name: 'A', status: 'ok', count: 1, secret: 'hidden' }];
    exportTableData({ data, columns: COLUMNS, filename: 'filter', format: 'json' });

    const text = await lastBlob!.text();
    const parsed = JSON.parse(text);
    expect(parsed).toEqual([{ name: 'A', status: 'ok', count: 1 }]);
    expect(parsed[0]).not.toHaveProperty('secret');
  });

  it('handles empty data array', async () => {
    exportTableData({ data: [], columns: COLUMNS, filename: 'empty', format: 'json' });

    const text = await lastBlob!.text();
    expect(JSON.parse(text)).toEqual([]);
  });
});
