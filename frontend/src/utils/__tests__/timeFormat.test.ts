import { describe, expect, it } from 'bun:test';

import {
  formatDuration,
  formatStartTime,
  formatDateTime,
  formatRelativeTime,
  formatTimeAgo,
} from '../timeFormat';

describe('formatDuration', () => {
  it('formats sub-second durations', () => {
    expect(formatDuration(500)).toBe('0.5s');
  });

  it('formats exact seconds', () => {
    expect(formatDuration(21000)).toBe('21.0s');
  });

  it('formats fractional seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(150000)).toBe('2m 30.0s');
  });

  it('formats minutes with fractional seconds', () => {
    expect(formatDuration(150500)).toBe('2m 30.5s');
  });

  it('formats zero milliseconds', () => {
    expect(formatDuration(0)).toBe('0.0s');
  });

  it('formats over an hour', () => {
    expect(formatDuration(3661000)).toBe('61m 1.0s');
  });
});

describe('formatStartTime', () => {
  it('returns "just now" for a very recent timestamp', () => {
    const now = new Date();
    expect(formatStartTime(now.toISOString())).toBe('just now');
  });

  it('returns minutes ago for timestamps within the hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatStartTime(fiveMinAgo.toISOString())).toBe('5m ago');
  });

  it('returns hours ago for timestamps within 24 hours', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(formatStartTime(twoHoursAgo.toISOString())).toBe('2h ago');
  });

  it('returns formatted date for timestamps older than 24 hours', () => {
    const oldDate = new Date('2024-06-15T14:30:00Z');
    const result = formatStartTime(oldDate.toISOString());
    expect(result).toContain('Jun');
    expect(result).toContain('15');
  });
});

describe('formatDateTime', () => {
  it('formats a valid ISO timestamp', () => {
    const result = formatDateTime('2025-01-15T10:30:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('returns em-dash for null', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('returns em-dash for undefined', () => {
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('returns em-dash for empty string', () => {
    expect(formatDateTime('')).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  it('returns empty string for null', () => {
    expect(formatRelativeTime(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatRelativeTime(undefined)).toBe('');
  });

  it('returns "Expired" for a past date', () => {
    const pastDate = new Date(Date.now() - 86400 * 1000);
    expect(formatRelativeTime(pastDate.toISOString())).toBe('Expired');
  });

  it('returns minutes left for near-future timestamps', () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const result = formatRelativeTime(soon.toISOString());
    expect(result).toMatch(/\d+m left/);
  });

  it('returns hours and minutes left for timestamps hours away', () => {
    const later = new Date(Date.now() + 5 * 3600 * 1000);
    const result = formatRelativeTime(later.toISOString());
    expect(result).toMatch(/\d+h \d+m left/);
  });

  it('returns days and hours left for timestamps days away', () => {
    const future = new Date(Date.now() + 3 * 86400 * 1000);
    const result = formatRelativeTime(future.toISOString());
    expect(result).toMatch(/\d+d \d+h left/);
  });
});

describe('formatTimeAgo', () => {
  it('returns "today" for a date today', () => {
    expect(formatTimeAgo(new Date())).toBe('today');
  });

  it('returns "1d ago" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400 * 1000);
    expect(formatTimeAgo(yesterday)).toBe('1d ago');
  });

  it('returns days ago for less than a week', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000);
    expect(formatTimeAgo(threeDaysAgo)).toBe('3d ago');
  });

  it('returns weeks ago for less than a month', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400 * 1000);
    expect(formatTimeAgo(twoWeeksAgo)).toBe('2w ago');
  });

  it('returns months ago for less than a year', () => {
    const twoMonthsAgo = new Date(Date.now() - 60 * 86400 * 1000);
    expect(formatTimeAgo(twoMonthsAgo)).toBe('2mo ago');
  });

  it('returns years ago for old dates', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86400 * 1000);
    expect(formatTimeAgo(twoYearsAgo)).toBe('2y ago');
  });

  it('accepts a string argument', () => {
    const now = new Date();
    expect(formatTimeAgo(now.toISOString())).toBe('today');
  });
});
