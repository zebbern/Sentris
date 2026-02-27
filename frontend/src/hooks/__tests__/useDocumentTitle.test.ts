import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useDocumentTitle } from '../useDocumentTitle';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('useDocumentTitle', () => {
  it('sets document.title to "{title} | ShipSec Studio" on mount', () => {
    renderHook(() => useDocumentTitle('Dashboard'));

    expect(document.title).toBe('Dashboard | ShipSec Studio');
  });

  it('resets document.title to "ShipSec Studio" on unmount', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Settings'));

    expect(document.title).toBe('Settings | ShipSec Studio');

    unmount();

    expect(document.title).toBe('ShipSec Studio');
  });

  it('updates document.title when the title argument changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Page A' },
    });

    expect(document.title).toBe('Page A | ShipSec Studio');

    rerender({ title: 'Page B' });

    expect(document.title).toBe('Page B | ShipSec Studio');
  });

  it('sets document.title to "ShipSec Studio" when given an empty string', () => {
    renderHook(() => useDocumentTitle(''));

    expect(document.title).toBe('ShipSec Studio');
  });
});
