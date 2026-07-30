import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';
import { componentRegistry } from '../../index';
import type { TerminalDemoInputZod, TerminalDemoOutputZod } from '../terminal-demo';

describe('terminal demo component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers in the component registry', () => {
    const component = componentRegistry.get<TerminalDemoInputZod, TerminalDemoOutputZod>(
      'sentris.security.terminal-demo',
    );
    expect(component).toBeDefined();
    expect(component?.label).toBe('Terminal Stream Demo');
  });

  it('invokes the docker runner to emit PTY-friendly output', async () => {
    const component = componentRegistry.get<TerminalDemoInputZod, TerminalDemoOutputZod>(
      'sentris.security.terminal-demo',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'demo-run',
      componentRef: 'terminal-demo',
    });

    const executePayload = {
      inputs: {},
      params: {
        message: 'Test message',
        durationSeconds: 5,
      },
    };

    const mockOutput = 'Demo completed successfully';

    const spy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(mockOutput);

    const result = component.outputs.parse(await component.execute(executePayload, context));

    expect(spy).toHaveBeenCalled();
    expect(result.message).toBe('Test message');
    expect(result.durationSeconds).toBe(5);
    expect(result.stepsCompleted).toBeGreaterThanOrEqual(0);
    expect(result.rawOutput).toBeTruthy();
  });

  it('keeps the Docker runner alive beyond the maximum supported demo duration', async () => {
    const component = componentRegistry.get<TerminalDemoInputZod, TerminalDemoOutputZod>(
      'sentris.security.terminal-demo',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({
      runId: 'long-demo-run',
      componentRef: 'terminal-demo',
    });
    const spy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue('Long demo completed successfully');

    const result = component.outputs.parse(
      await component.execute(
        {
          inputs: {},
          params: {
            message: 'Long-running crash recovery probe',
            durationSeconds: 300,
          },
        },
        context,
      ),
    );

    const runner = spy.mock.calls[0]?.[0];
    expect(runner?.kind).toBe('docker');
    if (!runner || runner.kind !== 'docker') {
      throw new Error('Terminal demo did not invoke the Docker runner');
    }
    expect(runner.timeoutSeconds).toBeGreaterThan(300);
    expect(result.durationSeconds).toBe(300);
  });
});
