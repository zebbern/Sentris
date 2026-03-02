import { describe, expect, it } from 'bun:test';

import {
  STATUS_COLOR_MAP,
  formatStatusText,
  getStatusColor,
  getStatusBadgeClass,
  getStatusBadgeClassFromStatus,
} from '../statusBadgeStyles';

describe('STATUS_COLOR_MAP', () => {
  it('covers all expected workflow execution statuses', () => {
    const expectedStatuses = [
      'RUNNING',
      'QUEUED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'TERMINATED',
      'TIMED_OUT',
      'AWAITING_INPUT',
      'STALE',
    ];
    for (const status of expectedStatuses) {
      expect(STATUS_COLOR_MAP[status]).toBeDefined();
    }
  });

  it('covers action center statuses', () => {
    expect(STATUS_COLOR_MAP['PENDING']).toBe('blue');
    expect(STATUS_COLOR_MAP['APPROVED']).toBe('green');
    expect(STATUS_COLOR_MAP['REJECTED']).toBe('red');
    expect(STATUS_COLOR_MAP['EXPIRED']).toBe('amber');
  });

  it('covers API key statuses', () => {
    expect(STATUS_COLOR_MAP['ACTIVE']).toBe('green');
    expect(STATUS_COLOR_MAP['REVOKED']).toBe('gray');
  });
});

describe('formatStatusText', () => {
  it('converts uppercase to title case', () => {
    expect(formatStatusText('FAILED')).toBe('Failed');
    expect(formatStatusText('COMPLETED')).toBe('Completed');
  });

  it('converts underscore-separated words to title case with spaces', () => {
    expect(formatStatusText('TIMED_OUT')).toBe('Timed Out');
    expect(formatStatusText('AWAITING_INPUT')).toBe('Awaiting Input');
  });

  it('converts space-separated words to title case', () => {
    expect(formatStatusText('NOT TRIGGERED')).toBe('Not Triggered');
  });

  it('handles empty string', () => {
    expect(formatStatusText('')).toBe('');
  });

  it('handles single word', () => {
    expect(formatStatusText('running')).toBe('Running');
  });
});

describe('getStatusColor', () => {
  it('returns blue for RUNNING', () => {
    expect(getStatusColor('RUNNING')).toBe('blue');
  });

  it('returns green for COMPLETED', () => {
    expect(getStatusColor('COMPLETED')).toBe('green');
  });

  it('returns red for FAILED', () => {
    expect(getStatusColor('FAILED')).toBe('red');
  });

  it('returns gray for CANCELLED', () => {
    expect(getStatusColor('CANCELLED')).toBe('gray');
  });

  it('returns amber for TIMED_OUT', () => {
    expect(getStatusColor('TIMED_OUT')).toBe('amber');
  });

  it('returns purple for AWAITING_INPUT', () => {
    expect(getStatusColor('AWAITING_INPUT')).toBe('purple');
  });

  it('is case-insensitive', () => {
    expect(getStatusColor('running')).toBe('blue');
    expect(getStatusColor('Failed')).toBe('red');
  });

  it('returns gray for unknown status', () => {
    expect(getStatusColor('UNKNOWN')).toBe('gray');
    expect(getStatusColor('')).toBe('gray');
  });
});

describe('getStatusBadgeClass', () => {
  it('returns a class string for each color variant', () => {
    const colors = ['blue', 'green', 'red', 'amber', 'gray', 'purple'] as const;
    for (const color of colors) {
      const result = getStatusBadgeClass(color);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('includes additional classes when provided', () => {
    const result = getStatusBadgeClass('blue', 'custom-class');
    expect(result).toContain('custom-class');
  });
});

describe('getStatusBadgeClassFromStatus', () => {
  it('maps COMPLETED to green badge class', () => {
    const result = getStatusBadgeClassFromStatus('COMPLETED');
    expect(result).toContain('emerald');
  });

  it('maps FAILED to red badge class', () => {
    const result = getStatusBadgeClassFromStatus('FAILED');
    expect(result).toContain('red');
  });

  it('maps RUNNING to blue badge class', () => {
    const result = getStatusBadgeClassFromStatus('RUNNING');
    expect(result).toContain('blue');
  });

  it('maps unknown status to gray badge class', () => {
    const result = getStatusBadgeClassFromStatus('BOGUS');
    expect(result).toContain('muted');
  });

  it('includes additional classes when provided', () => {
    const result = getStatusBadgeClassFromStatus('FAILED', 'extra');
    expect(result).toContain('extra');
  });
});
