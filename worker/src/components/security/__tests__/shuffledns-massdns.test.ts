import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';
import { componentRegistry } from '../../index';
import type {
  ShufflednsMassdnsInput,
  ShufflednsMassdnsInputData,
  ShufflednsMassdnsOutput,
} from '../shuffledns-massdns';

describe('shuffledns-massdns component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers with expected metadata', () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    expect(component).toBeDefined();
    expect(component!.label).toBe('Shuffledns + MassDNS');
    expect(component!.category).toBe('security');
    expect(component!.ui?.slug).toBe('shuffledns-massdns');
  });

  it('normalises plain text output into subdomains array', async () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');

    const context = sdk.createExecutionContext({ runId: 'run-1', componentRef: 'shuffledns-test' });

    const executePayload = {
      inputs: {
        domains: ['example.com'],
        words: ['www', 'api', 'dev'],
      },
      params: {
        mode: 'bruteforce' as const,
      },
    };

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      'www.example.com\napi.example.com\napi.example.com\n',
    );

    const result = await component.execute(
      {
        inputs: component.inputs.parse(executePayload.inputs),
        params: component.parameters!.parse(executePayload.params),
      },
      context,
    );
    expect(result.domainCount).toBe(1);
    // Deduped
    expect(result.subdomains).toEqual(['www.example.com', 'api.example.com']);
    expect(result.subdomainCount).toBe(2);
  });

  it('uses docker runner with correct image', () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');
    expect(component.runner.kind).toBe('docker');
    if (component.runner.kind === 'docker') {
      expect(component.runner.image).toBe('projectdiscovery/shuffledns:latest');
      // We no longer depend on a shell entrypoint; the execute path sets
      // the entrypoint to the tool binary and passes flags directly.
      // The static runner definition just provides image/network defaults.
      expect(component.runner.entrypoint).toBeUndefined();
    }
  });

  it('builds a ProjectDiscovery-compatible bruteforce command', async () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');

    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('www.example.com');

    await component.execute(
      {
        inputs: component.inputs.parse({
          domains: ['example.com'],
          words: ['www'],
          resolvers: ['1.1.1.1'],
          trustedResolvers: ['8.8.8.8'],
        }),
        params: component.parameters!.parse({
          mode: 'bruteforce',
          wildcardStrict: true,
          threads: 25,
          retries: 1,
        }),
      },
      sdk.createExecutionContext({ runId: 'run-2', componentRef: 'shuffledns-command-test' }),
    );

    const runnerConfig = runnerSpy.mock.calls[0]?.[0] as
      | { image?: string; entrypoint?: string; command?: string[] }
      | undefined;
    const command = runnerConfig?.command ?? [];

    expect(runnerConfig?.image).toBe('projectdiscovery/shuffledns:latest');
    expect(runnerConfig?.entrypoint).toBe('shuffledns');
    expect(command).toContain('-w');
    expect(command).toContain('-d');
    expect(command).toContain('example.com');
    expect(command).toContain('-strict-wildcard');
    expect(command).not.toContain('-mode');
    expect(command).not.toContain('-tr');
    expect(command).not.toContain('-sw');
  });

  it('builds a ProjectDiscovery-compatible resolve command', async () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');

    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('www.example.com');

    await component.execute(
      {
        inputs: component.inputs.parse({
          domains: ['example.com'],
          seeds: ['www.example.com'],
          resolvers: ['1.1.1.1'],
          trustedResolvers: ['8.8.8.8'],
        }),
        params: component.parameters!.parse({ mode: 'resolve' }),
      },
      sdk.createExecutionContext({ runId: 'run-3', componentRef: 'shuffledns-resolve-test' }),
    );

    const command =
      (runnerSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command ?? [];

    expect(command).toContain('-list');
    expect(command).not.toContain('-mode');
  });

  it('defaults resolvers when execute receives unparsed inputs without trustedResolvers', async () => {
    const component = componentRegistry.get<ShufflednsMassdnsInput, ShufflednsMassdnsOutput>(
      'sentris.shuffledns.massdns',
    );
    if (!component) throw new Error('Component not registered');

    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('www.example.com');

    await component.execute(
      {
        inputs: {
          domains: ['example.com'],
          words: ['www'],
          resolvers: ['1.1.1.1'],
        } as unknown as ShufflednsMassdnsInputData,
        params: { mode: 'bruteforce' as const },
      },
      sdk.createExecutionContext({ runId: 'run-4', componentRef: 'shuffledns-default-resolvers' }),
    );

    const command =
      (runnerSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)?.command ?? [];

    expect(command).toContain('-r');
  });
});
