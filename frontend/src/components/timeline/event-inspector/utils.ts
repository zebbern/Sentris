import { INSIGNIFICANT_PAYLOAD_KEYS } from './constants';

export const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

export const normalizeEventPayload = (data: unknown): Record<string, unknown> | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(([key, value]) => {
    if (INSIGNIFICANT_PAYLOAD_KEYS.has(key)) return false;
    return hasMeaningfulValue(value);
  });
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
};

export const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const base = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${base}.${String(date.getMilliseconds()).padStart(3, '0')}`;
};

export const formatDuration = (start: string, end?: string): string => {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = Math.max(0, endTime - startTime);

  if (duration < 1000) {
    return `${duration}ms`;
  } else if (duration < 60000) {
    return `${(duration / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
};

export const formatData = (data: Record<string, unknown>): string => {
  try {
    return JSON.stringify(data, null, 2);
  } catch (_error: unknown) {
    return 'Unable to render data payload';
  }
};
