import { describe, it, expect } from 'bun:test';
import { clampValue, formatTime } from '../utils';

describe('clampValue', () => {
  it('clamps below min', () => {
    expect(clampValue(-1, 0, 10)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clampValue(11, 0, 10)).toBe(10);
  });

  it('passes through in-range values', () => {
    expect(clampValue(5, 0, 10)).toBe(5);
  });
});

describe('formatTime', () => {
  it('formats milliseconds under 1s', () => {
    expect(formatTime(0)).toBe('0ms');
    expect(formatTime(230)).toBe('230ms');
    expect(formatTime(900)).toBe('900ms');
  });

  it('formats seconds under 1 minute', () => {
    expect(formatTime(2300)).toBe('2.3s');
    expect(formatTime(5000)).toBe('5s');
    expect(formatTime(55_000)).toBe('55s');
  });

  it('formats minutes under 1 hour', () => {
    expect(formatTime(60_000)).toBe('1m');
    expect(formatTime(90_000)).toBe('1.5m');
    expect(formatTime(120_000)).toBe('2m');
  });

  it('formats hours at and above 1 hour', () => {
    expect(formatTime(3_600_000)).toBe('1h');
    expect(formatTime(5_400_000)).toBe('1.5h');
  });
});
