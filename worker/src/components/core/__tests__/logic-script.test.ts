import { afterEach, describe, expect, it, vi } from 'bun:test';
import { definition } from '../logic-script';
import {
  extractPorts,
  type DockerRunnerConfig,
  type ExecutionContext,
} from '@sentris/component-sdk';
import * as sdk from '@sentris/component-sdk';

// Mock context
const mockContext: ExecutionContext = {
  runId: 'test-run',
  componentRef: 'test-node',
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  emitProgress: () => {},
  metadata: {
    runId: 'test-run',
    componentRef: 'test-node',
  },
  http: {
    fetch: async () => new Response(),
    toCurl: () => '',
  },
};

function decodeGeneratedFile(command: string, filename: 'plugin.ts' | 'harness.ts'): string {
  const match = command.match(new RegExp(`echo "([^"]+)" \\| base64 -d > ${filename}`));
  expect(match).not.toBeNull();
  return Buffer.from(match![1], 'base64').toString('utf8');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Logic/Script Component', () => {
  it('executes simple JavaScript math', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ sum: 3 });
    const result = await definition.execute(
      {
        inputs: {},
        params: {
          code: 'export async function script() { return { sum: 1 + 2 }; }',
          variables: [],
          returns: [{ name: 'sum', type: 'number' }],
        },
      },
      mockContext,
    );

    expect(result).toEqual({ sum: 3 });
  });

  it('does not mirror host-side execution diagnostics to console.log by default', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ sum: 3 });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await definition.execute(
      {
        inputs: {},
        params: {
          code: 'export async function script() { return { sum: 1 + 2 }; }',
          variables: [],
          returns: [{ name: 'sum', type: 'number' }],
        },
      },
      mockContext,
    );

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('gates sandbox success diagnostics behind component debug logging', async () => {
    const previousDebugFlag = process.env.SENTRIS_DEBUG_COMPONENTS;
    delete process.env.SENTRIS_DEBUG_COMPONENTS;

    const runSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ sum: 3 });

    try {
      await definition.execute(
        {
          inputs: {},
          params: {
            code: 'export async function script() { return { sum: 1 + 2 }; }',
            variables: [],
            returns: [{ name: 'sum', type: 'number' }],
          },
        },
        mockContext,
      );

      const [runnerConfig] = runSpy.mock.calls[0] as [DockerRunnerConfig, ...unknown[]];
      const command = runnerConfig.command.join(' ');
      const pluginSource = decodeGeneratedFile(command, 'plugin.ts');
      const harnessSource = decodeGeneratedFile(command, 'harness.ts');

      expect(runnerConfig.env).toEqual({ SENTRIS_DEBUG_COMPONENTS: '' });
      expect(pluginSource).toContain('SENTRIS_DEBUG_COMPONENTS');
      expect(harnessSource).toContain('SENTRIS_DEBUG_COMPONENTS');
      expect(pluginSource).not.toContain('console.log("[http-loader] Fetching:", href);');
      expect(harnessSource).not.toContain("console.log('[Script] Starting execution...');");
      expect(harnessSource).not.toContain(
        "console.log('[Script] Execution completed, writing output...');",
      );
      expect(harnessSource).not.toContain(
        "console.log('[Script] Output written to', OUTPUT_PATH);",
      );
    } finally {
      if (previousDebugFlag === undefined) {
        delete process.env.SENTRIS_DEBUG_COMPONENTS;
      } else {
        process.env.SENTRIS_DEBUG_COMPONENTS = previousDebugFlag;
      }
    }
  });

  it('transpiles and executes TypeScript', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ msg: 'Value is 10' });
    const tsCode = `
      interface Result { msg: string; }
      export async function script(): Promise<Result> {
        const calculate = (a: number): Result => {
          return { msg: 'Value is ' + a };
        };
        const res: Result = calculate(10);
        return res;
      }
    `;

    const result = await definition.execute(
      {
        inputs: {},
        params: {
          code: tsCode,
          variables: [],
          returns: [{ name: 'msg', type: 'string' }],
        },
      },
      mockContext,
    );

    expect(result).toEqual({ msg: 'Value is 10' });
  });

  it('accepts input variables and returns outputs', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ diff: 6, product: 40 });
    const result = await definition.execute(
      {
        inputs: {
          x: 10,
          y: 4,
        },
        params: {
          code: `
          export async function script(input) {
            return {
              diff: input.x - input.y,
              product: input.x * input.y
            };
          }
        `,
          variables: [
            { name: 'x', type: 'number' },
            { name: 'y', type: 'number' },
          ],
          returns: [
            { name: 'diff', type: 'number' },
            { name: 'product', type: 'number' },
          ],
        },
      } as any,
      mockContext,
    );

    expect(result).toEqual({ diff: 6, product: 40 });
  });

  it('can access global fetch', async () => {
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue({ status: 200 });
    const code = `
      export async function script() {
        const res = await fetch('https://www.google.com');
        return { status: res.status };
      }
    `;

    const result = await definition.execute(
      {
        inputs: {},
        params: {
          code,
          variables: [],
          returns: [{ name: 'status', type: 'number' }],
        },
      },
      mockContext,
    );

    expect(result.status).toBe(200);
  });

  it('correctly resolves ports', () => {
    const params = {
      code: '',
      variables: [{ name: 'in1', type: 'string' as const }],
      returns: [{ name: 'out1', type: 'boolean' as const }],
    };
    const ports = definition.resolvePorts!(params)!;

    const inputPorts = extractPorts(ports.inputs!);
    const outputPorts = extractPorts(ports.outputs!);

    expect(inputPorts).toHaveLength(1);
    expect(inputPorts[0].id).toBe('in1');
    expect(inputPorts[0].connectionType).toEqual({ kind: 'primitive', name: 'text' });

    expect(outputPorts).toHaveLength(1);
    expect(outputPorts[0].id).toBe('out1');
    expect(outputPorts[0].connectionType).toEqual({ kind: 'primitive', name: 'boolean' });
  });
});
