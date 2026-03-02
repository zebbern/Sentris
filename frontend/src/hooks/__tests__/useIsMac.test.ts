import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useIsMac } from '../useIsMac';

afterEach(cleanup);

describe('useIsMac', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');
  const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  const originalUserAgentData = Object.getOwnPropertyDescriptor(navigator, 'userAgentData');

  function setPlatform(platform: string, userAgent = '') {
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
    // Ensure userAgentData doesn't interfere
    Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true });
  }

  afterEach(() => {
    // Restore originals
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform);
    }
    if (originalUserAgent) {
      Object.defineProperty(navigator, 'userAgent', originalUserAgent);
    }
    if (originalUserAgentData) {
      Object.defineProperty(navigator, 'userAgentData', originalUserAgentData);
    }
  });

  it('returns true when platform contains "Mac"', () => {
    setPlatform('MacIntel');
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(true);
  });

  it('returns true for "macos" platform (case-insensitive)', () => {
    setPlatform('macOS');
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(true);
  });

  it('returns false for Windows platform', () => {
    setPlatform('Win32');
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(false);
  });

  it('returns false for Linux platform', () => {
    setPlatform('Linux x86_64');
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(false);
  });

  it('falls back to userAgent when platform is empty', () => {
    setPlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(true);
  });

  it('returns true when userAgentData.platform is "macOS"', () => {
    Object.defineProperty(navigator, 'platform', { value: '', configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: '', configurable: true });
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: 'macOS' },
      configurable: true,
    });
    const { result } = renderHook(() => useIsMac());
    expect(result.current).toBe(true);
  });
});
