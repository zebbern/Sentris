const SIGNED_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Prefix spreadsheet formula-capable text with an apostrophe while preserving
 * ordinary signed numeric values.
 */
export function neutralizeCsvFormula(value: string): string {
  if (value.length === 0 || value.startsWith("'")) {
    return value;
  }

  const candidate = value.trimStart();
  if (candidate.length === 0 || SIGNED_NUMBER.test(candidate)) {
    return value;
  }

  if (/^[=+\-@]/.test(candidate) || /^[\t\r\n]/.test(value)) {
    return `'${value}`;
  }

  return value;
}

/** Format one RFC 4180 cell with spreadsheet-formula neutralization. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const safe = neutralizeCsvFormula(String(value));
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
