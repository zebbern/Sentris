import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize() {
      return 'mock-volume';
    }

    getVolumeConfig(containerPath = '/output', readOnly = false) {
      return { source: 'mock-volume', target: containerPath, readOnly };
    }

    async readFiles() {
      return { 'results.json': JSON.stringify({ issues: [] }) };
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('supabase-scanner component', () => {
  beforeAll(async () => {
    await import('../supabase-scanner');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes a 20-character project ref into an https supabase URL', async () => {
    const component = componentRegistry.get<any, any>('sentris.supabase.scanner');
    if (!component) throw new Error('Supabase scanner was not registered');

    const parsed = component.inputs.parse({
      supabaseUrl: 'abcdefghijklmnopqrst',
    });

    expect(parsed.supabaseUrl).toBe('https://abcdefghijklmnopqrst.supabase.co');
  });

  it('passes the normalized project URL to the scanner command', async () => {
    const component = componentRegistry.get<any, any>('sentris.supabase.scanner');
    if (!component) throw new Error('Supabase scanner was not registered');

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');

    await component.execute(
      {
        inputs: {
          supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
          databaseConnectionString:
            'postgres://postgres:password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
        },
        params: {
          failOnCritical: false,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'supabase-cli' }),
    );

    expect(runSpy).toHaveBeenCalledTimes(1);
    const runnerConfig = runSpy.mock.calls[0]?.[0] as
      | { command?: string[]; volumes?: unknown[] }
      | undefined;
    expect(runnerConfig?.volumes?.length).toBeGreaterThan(0);
    expect(runnerConfig?.command?.join(' ')).toContain('scanner_config.yaml');
  });
});
