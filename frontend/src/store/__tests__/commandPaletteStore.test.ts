import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { realModuleExports } from '@/test/restore-mocks';

// Override any bled mock.module with the real store
mock.module('@/store/commandPaletteStore', () => realModuleExports('@/store/commandPaletteStore'));

import { useCommandPaletteStore } from '../commandPaletteStore';

describe('commandPaletteStore', () => {
  beforeEach(() => {
    // Reset to initial state
    useCommandPaletteStore.setState({ isOpen: false });
  });

  it('initializes with palette closed', () => {
    const state = useCommandPaletteStore.getState();
    expect(state.isOpen).toBe(false);
  });

  it('open() sets isOpen to true', () => {
    useCommandPaletteStore.getState().open();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it('close() sets isOpen to false', () => {
    useCommandPaletteStore.setState({ isOpen: true });
    useCommandPaletteStore.getState().close();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('toggle() flips state from false to true', () => {
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it('toggle() flips state from true to false', () => {
    useCommandPaletteStore.setState({ isOpen: true });
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('toggle() called twice returns to original state', () => {
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    useCommandPaletteStore.getState().toggle();
    useCommandPaletteStore.getState().toggle();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('open() is idempotent when already open', () => {
    useCommandPaletteStore.getState().open();
    useCommandPaletteStore.getState().open();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
  });

  it('close() is idempotent when already closed', () => {
    useCommandPaletteStore.getState().close();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it('supports granular selector pattern', () => {
    const isOpen = useCommandPaletteStore.getState().isOpen;
    expect(typeof isOpen).toBe('boolean');
  });
});
