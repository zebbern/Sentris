import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import { useDocumentTitle } from '../useDocumentTitle';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('useDocumentTitle', () => {
  it('sets document.title to "{title} | Sentris Flow" on mount', () => {
    renderHook(() => useDocumentTitle('Dashboard'));

    expect(document.title).toBe('Dashboard | Sentris Flow');
  });

  it('resets document.title to "Sentris Flow" on unmount', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Settings'));

    expect(document.title).toBe('Settings | Sentris Flow');

    unmount();

    expect(document.title).toBe('Sentris Flow');
  });

  it('updates document.title when the title argument changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Page A' },
    });

    expect(document.title).toBe('Page A | Sentris Flow');

    rerender({ title: 'Page B' });

    expect(document.title).toBe('Page B | Sentris Flow');
  });

  it('sets document.title to "Sentris Flow" when given an empty string', () => {
    renderHook(() => useDocumentTitle(''));

    expect(document.title).toBe('Sentris Flow');
  });
});
