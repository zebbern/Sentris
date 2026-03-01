export const STATUS_COLORS: Record<string, string> = {
  '2xx': 'text-emerald-600 dark:text-emerald-400',
  '3xx': 'text-blue-600 dark:text-blue-400',
  '4xx': 'text-amber-600 dark:text-amber-400',
  '5xx': 'text-rose-600 dark:text-rose-400',
  error: 'text-rose-600 dark:text-rose-400',
};

export const getStatusColor = (status?: number, hasError?: boolean): string => {
  if (hasError) return STATUS_COLORS.error;
  if (!status) return 'text-muted-foreground';
  if (status >= 200 && status < 300) return STATUS_COLORS['2xx'];
  if (status >= 300 && status < 400) return STATUS_COLORS['3xx'];
  if (status >= 400 && status < 500) return STATUS_COLORS['4xx'];
  if (status >= 500) return STATUS_COLORS['5xx'];
  return 'text-muted-foreground';
};

export const formatDuration = (ms?: number): string => {
  if (ms === undefined || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatBytes = (bytes?: number): string => {
  if (bytes === undefined || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const parseUrl = (url: string): { host: string; path: string } => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      path: parsed.pathname + parsed.search,
    };
  } catch {
    return { host: '', path: url };
  }
};

export function tryFormatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
