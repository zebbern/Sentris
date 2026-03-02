import { describe, it, expect, mock, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks (BEFORE imports)
// ---------------------------------------------------------------------------

mock.module('@/config/env', () => ({
  env: {
    VITE_ENABLE_CONNECTIONS: false,
    VITE_ENABLE_IT_OPS: false,
  },
}));

import { useStaticCommands } from '../useStaticCommands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createOptions = () => ({
  navigate: mock(() => {}),
  close: mock(() => {}),
  theme: 'dark' as string,
  startTransition: mock(() => {}),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

describe('useStaticCommands', () => {
  it('returns an array of commands', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));

    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current.length).toBeGreaterThan(0);
  });

  it('includes navigation commands (Workflows, Schedules, Secrets, etc.)', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));
    const ids = result.current.map((c) => c.id);

    expect(ids).toContain('nav-workflows');
    expect(ids).toContain('nav-schedules');
    expect(ids).toContain('nav-secrets');
    expect(ids).toContain('nav-api-keys');
    expect(ids).toContain('nav-artifacts');
    expect(ids).toContain('nav-webhooks');
    expect(ids).toContain('nav-action-center');
    expect(ids).toContain('nav-mcp-servers');
  });

  it('includes action commands (new workflow, toggle theme)', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));
    const ids = result.current.map((c) => c.id);

    expect(ids).toContain('new-workflow');
    expect(ids).toContain('toggle-theme');
  });

  it('every command has required fields: id, label, category, type', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));

    for (const cmd of result.current) {
      expect(typeof cmd.id).toBe('string');
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(typeof cmd.label).toBe('string');
      expect(cmd.label.length).toBeGreaterThan(0);
      expect(typeof cmd.category).toBe('string');
      expect(typeof cmd.type).toBe('string');
    }
  });

  it('navigation commands have href', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));

    const navCommands = result.current.filter((c) => c.type === 'navigation');
    for (const cmd of navCommands) {
      if (cmd.type === 'navigation') {
        expect(typeof cmd.href).toBe('string');
      }
    }
  });

  it('action commands have action function', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));

    const actionCommands = result.current.filter((c) => c.type === 'action');
    for (const cmd of actionCommands) {
      if (cmd.type === 'action') {
        expect(typeof cmd.action).toBe('function');
      }
    }
  });

  it('toggle-theme label reflects current theme', () => {
    const darkOpts = createOptions();
    darkOpts.theme = 'dark';
    const { result: darkResult } = renderHook(() => useStaticCommands(darkOpts));
    const darkThemeCmd = darkResult.current.find((c) => c.id === 'toggle-theme');
    expect(darkThemeCmd?.label).toContain('Light');

    cleanup();

    const lightOpts = createOptions();
    lightOpts.theme = 'light';
    const { result: lightResult } = renderHook(() => useStaticCommands(lightOpts));
    const lightThemeCmd = lightResult.current.find((c) => c.id === 'toggle-theme');
    expect(lightThemeCmd?.label).toContain('Dark');
  });

  it('new-workflow action calls navigate and close', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));
    const newWorkflowCmd = result.current.find((c) => c.id === 'new-workflow');
    expect(newWorkflowCmd).toBeDefined();
    if (newWorkflowCmd?.type === 'action') {
      newWorkflowCmd.action();
      expect(opts.navigate).toHaveBeenCalledWith('/workflows/new');
      expect(opts.close).toHaveBeenCalled();
    }
  });

  it('does not include connections when VITE_ENABLE_CONNECTIONS is false', () => {
    const opts = createOptions();
    const { result } = renderHook(() => useStaticCommands(opts));
    const ids = result.current.map((c) => c.id);
    expect(ids).not.toContain('nav-connections');
  });
});
