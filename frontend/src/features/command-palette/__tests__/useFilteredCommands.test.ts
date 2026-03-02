import { describe, it, expect, afterEach } from 'bun:test';
import { renderHook, cleanup } from '@testing-library/react';
import type { Command } from '../command-palette-types';
import { useFilteredCommands } from '../useFilteredCommands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

const makeNavCmd = (
  id: string,
  label: string,
  category: Command['category'] = 'navigation',
  extra: Partial<Command> = {},
): Command =>
  ({
    id,
    type: 'navigation',
    label,
    category,
    href: `/${id}`,
    keywords: [],
    ...extra,
  }) as Command;

const makeActionCmd = (id: string, label: string): Command =>
  ({
    id,
    type: 'action',
    label,
    category: 'actions',
    keywords: [],
    action: () => {},
  }) as Command;

const makeWorkflowCmd = (id: string, name: string): Command =>
  ({
    id: `workflow-${id}`,
    type: 'workflow',
    label: name,
    category: 'workflows',
    workflowId: id,
    keywords: [name.toLowerCase(), 'workflow'],
  }) as Command;

const makeComponentCmd = (id: string, name: string): Command =>
  ({
    id: `component-${id}`,
    type: 'component',
    label: name,
    category: 'components',
    componentId: id,
    componentName: name,
    keywords: [name.toLowerCase(), 'component'],
  }) as Command;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFilteredCommands', () => {
  it('returns all static + limited entity commands when query is empty', () => {
    const staticCmds = [makeNavCmd('a', 'Dashboard'), makeActionCmd('b', 'Toggle Theme')];
    const workflowCmds = [makeWorkflowCmd('w1', 'WF One')];
    const componentCmds = [makeComponentCmd('c1', 'HTTP Request')];
    const allCmds = [...staticCmds, ...workflowCmds, ...componentCmds];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: '',
        allCommands: allCmds,
        staticCommands: staticCmds,
        workflowCommands: workflowCmds,
        componentCommands: componentCmds,
        canPlaceComponents: true,
      }),
    );

    // Should include static + entity commands
    expect(result.current.filteredCommands.length).toBeGreaterThanOrEqual(staticCmds.length);
    // All static commands should be present
    for (const sc of staticCmds) {
      expect(result.current.filteredCommands.map((c) => c.id)).toContain(sc.id);
    }
  });

  it('excludes component commands when canPlaceComponents is false and query is empty', () => {
    const staticCmds = [makeNavCmd('a', 'Dashboard')];
    const componentCmds = [makeComponentCmd('c1', 'HTTP Request')];
    const allCmds = [...staticCmds, ...componentCmds];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: '',
        allCommands: allCmds,
        staticCommands: staticCmds,
        workflowCommands: [],
        componentCommands: componentCmds,
        canPlaceComponents: false,
      }),
    );

    const ids = result.current.filteredCommands.map((c) => c.id);
    expect(ids).not.toContain('component-c1');
  });

  it('filters commands by query term and excludes zero-score', () => {
    const cmds = [
      makeNavCmd('nav-dash', 'Dashboard', 'navigation', { keywords: ['home'] }),
      makeNavCmd('nav-secrets', 'Secrets', 'navigation', { keywords: ['credentials'] }),
    ];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: 'dashboard',
        allCommands: cmds,
        staticCommands: cmds,
        workflowCommands: [],
        componentCommands: [],
        canPlaceComponents: false,
      }),
    );

    const ids = result.current.filteredCommands.map((c) => c.id);
    expect(ids).toContain('nav-dash');
    expect(ids).not.toContain('nav-secrets');
  });

  it('sorts filtered commands by descending score', () => {
    const cmds = [
      makeNavCmd('contains', 'abcdashboardxyz', 'navigation'), // contains → 60
      makeNavCmd('exact', 'dashboard', 'navigation'), // exact → 100
      makeNavCmd('starts', 'dashboard settings', 'navigation'), // starts-with → 80
    ];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: 'dashboard',
        allCommands: cmds,
        staticCommands: cmds,
        workflowCommands: [],
        componentCommands: [],
        canPlaceComponents: false,
      }),
    );

    const ids = result.current.filteredCommands.map((c) => c.id);
    expect(ids[0]).toBe('exact');
    expect(ids[1]).toBe('starts');
    expect(ids[2]).toBe('contains');
  });

  it('groups commands by category', () => {
    const cmds = [
      makeNavCmd('nav-1', 'Dashboard', 'navigation'),
      makeActionCmd('act-1', 'Toggle Theme'),
    ];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: '',
        allCommands: cmds,
        staticCommands: cmds,
        workflowCommands: [],
        componentCommands: [],
        canPlaceComponents: false,
      }),
    );

    const categories = result.current.groupedCommands.map((g) => g.category);
    expect(categories).toContain('navigation');
    expect(categories).toContain('actions');
  });

  it('flatCommandList contains all commands from grouped results in order', () => {
    const cmds = [
      makeActionCmd('act-1', 'Toggle Theme'),
      makeNavCmd('nav-1', 'Dashboard', 'navigation'),
    ];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: '',
        allCommands: cmds,
        staticCommands: cmds,
        workflowCommands: [],
        componentCommands: [],
        canPlaceComponents: false,
      }),
    );

    const groupedIds = result.current.groupedCommands.flatMap((g) => g.commands.map((c) => c.id));
    const flatIds = result.current.flatCommandList.map((c) => c.id);
    expect(flatIds).toEqual(groupedIds);
  });

  it('returns empty results when query matches nothing', () => {
    const cmds = [makeNavCmd('nav-1', 'Dashboard', 'navigation')];

    const { result } = renderHook(() =>
      useFilteredCommands({
        query: 'zzzzzzz',
        allCommands: cmds,
        staticCommands: cmds,
        workflowCommands: [],
        componentCommands: [],
        canPlaceComponents: false,
      }),
    );

    expect(result.current.filteredCommands).toHaveLength(0);
    expect(result.current.groupedCommands).toHaveLength(0);
    expect(result.current.flatCommandList).toHaveLength(0);
  });
});
