import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import * as devRuntime from '../lib/dev-instance-runtime';

const {
  createE2eTestCommand,
  createSecurityComponentsVerifyPlan,
  createDevHealthProbeTargets,
  formatDevHealthProbeResult,
  probeDevHealthTarget,
  createRootTestPlan,
  createTemplateLibraryVerifyPlan,
  createPm2AppNames,
  ensureInstanceEnvFiles,
  parseDevScriptArgs,
  parseE2eEnvFile,
  prunePm2DevLogs,
  resolvePm2Command,
  readE2eEnvFile,
  resolveActiveDevInstance,
  resolveActiveE2eInstance,
  shouldStopSharedInfra,
} = devRuntime as typeof devRuntime & {
  createE2eTestCommand: (options: {
    instance: number;
    targets: string[];
    extraArgs?: string[];
    cloud?: boolean;
  }) => {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  createRootTestPlan: (options: { instance: number }) => {
    cleanupPaths: string[];
    commands: Array<{
      command: string;
      args: string[];
      env?: Record<string, string>;
      cwd?: string;
    }>;
  };
  createTemplateLibraryVerifyPlan: () => {
    commands: Array<{ command: string; args: string[]; cwd?: string }>;
  };
  createSecurityComponentsVerifyPlan: () => {
    commands: Array<{ command: string; args: string[]; cwd?: string }>;
  };
  createDevHealthProbeTargets: (instance: number) => Array<{
    id: string;
    label: string;
    url: string;
  }>;
  formatDevHealthProbeResult: (result: {
    label: string;
    url: string;
    ok: boolean;
    statusCode?: number;
    statusText?: string;
    error?: string;
  }) => string;
  probeDevHealthTarget: (
    target: { id: string; label: string; url: string },
    options: {
      request: (url: string, options: { timeoutMs: number }) => Promise<{
        statusCode: number;
        statusText?: string;
      }>;
      timeoutMs?: number;
    },
  ) => Promise<{
    id: string;
    label: string;
    url: string;
    ok: boolean;
    statusCode?: number;
    statusText?: string;
    error?: string;
  }>;
  ensureInstanceEnvFiles: (options: { root: string; instance: number }) => {
    instance: number;
    dir: string;
    files: Array<{ app: string; filePath: string; created: boolean }>;
  };
  parseDevScriptArgs: (argv: string[]) => {
    action: 'start' | 'stop' | 'logs' | 'status' | 'clean' | 'help';
    dryRun: boolean;
  };
  parseE2eEnvFile: (content: string) => Record<string, string>;
  prunePm2DevLogs: (options: {
    instance: number;
    pm2Home: string;
    maxBytes: number;
  }) => {
    logDir: string;
    maxBytes: number;
    files: Array<{ filePath: string; beforeBytes: number; afterBytes: number; pruned: boolean }>;
  };
  readE2eEnvFile: (options: {
    env?: Record<string, string | undefined>;
    fileExists?: (filePath: string) => boolean;
    readFile?: (filePath: string) => string;
    root?: string;
  }) => { filePath: string; values: Record<string, string> } | null;
};

describe('dev script instance runtime', () => {
  it('uses SENTRIS_INSTANCE before the active instance file', () => {
    const instance = resolveActiveDevInstance({
      env: { SENTRIS_INSTANCE: '4' },
      readActiveInstanceFile: () => '2',
    });

    expect(instance).toBe(4);
  });

  it('uses the active instance file when SENTRIS_INSTANCE is absent', () => {
    const instance = resolveActiveDevInstance({
      env: {},
      readActiveInstanceFile: () => '7',
    });

    expect(instance).toBe(7);
  });

  it('initializes the active instance marker to 0 when no active instance is configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentris-active-instance-default-'));

    try {
      const instance = resolveActiveDevInstance({
        env: {},
        root,
      });

      expect(instance).toBe(0);
      expect(readFileSync(join(root, '.sentris-instance'), 'utf8')).toBe('0\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses E2E_INSTANCE as an E2E-only legacy fallback after SENTRIS_INSTANCE', () => {
    expect(
      resolveActiveE2eInstance({
        env: { SENTRIS_INSTANCE: '6', E2E_INSTANCE: '2' },
        readActiveInstanceFile: () => '4',
      }),
    ).toBe(6);
    expect(
      resolveActiveE2eInstance({
        env: { E2E_INSTANCE: '2' },
        readActiveInstanceFile: () => '4',
      }),
    ).toBe(2);
    expect(
      resolveActiveE2eInstance({
        env: {},
        readActiveInstanceFile: () => '4',
      }),
    ).toBe(4);
  });

  it('builds PM2 app names for the selected instance', () => {
    expect(createPm2AppNames(5)).toEqual([
      'sentris-frontend-5',
      'sentris-backend-5',
      'sentris-worker-5',
    ]);
  });

  it('only stops shared infra for instance 0', () => {
    expect(shouldStopSharedInfra(0)).toBe(true);
    expect(shouldStopSharedInfra(1)).toBe(false);
  });

  it('builds runtime health probe targets for the selected instance', () => {
    expect(createDevHealthProbeTargets(2)).toEqual([
      {
        id: 'frontend',
        label: 'Frontend',
        url: 'http://127.0.0.1:5373',
      },
      {
        id: 'backend-liveness',
        label: 'Backend liveness',
        url: 'http://127.0.0.1:3411/health',
      },
      {
        id: 'backend-readiness',
        label: 'Backend readiness',
        url: 'http://127.0.0.1:3411/health/ready',
      },
      {
        id: 'worker-health',
        label: 'Worker health',
        url: 'http://127.0.0.1:9300/health',
      },
    ]);
  });

  it('formats dev runtime health probe results for healthy, not-ready, and unreachable services', () => {
    expect(
      formatDevHealthProbeResult({
        label: 'Backend liveness',
        url: 'http://127.0.0.1:3211/health',
        ok: true,
        statusCode: 200,
        statusText: 'OK',
      }),
    ).toBe('✓ Backend liveness: OK (HTTP 200 OK) http://127.0.0.1:3211/health');

    expect(
      formatDevHealthProbeResult({
        label: 'Backend readiness',
        url: 'http://127.0.0.1:3211/health/ready',
        ok: false,
        statusCode: 503,
        statusText: 'Service Unavailable',
      }),
    ).toBe(
      '⚠ Backend readiness: NOT READY (HTTP 503 Service Unavailable) http://127.0.0.1:3211/health/ready',
    );

    expect(
      formatDevHealthProbeResult({
        label: 'Backend liveness',
        url: 'http://127.0.0.1:3211/health',
        ok: false,
        error: 'ConnectionRefused',
      }),
    ).toBe(
      '✗ Backend liveness: UNREACHABLE (ConnectionRefused) http://127.0.0.1:3211/health',
    );
  });

  it('probes dev runtime health targets with injected request behavior', async () => {
    const healthy = await probeDevHealthTarget(
      {
        id: 'backend-liveness',
        label: 'Backend liveness',
        url: 'http://127.0.0.1:3211/health',
      },
      {
        timeoutMs: 250,
        request: async (url, options) => {
          expect(url).toBe('http://127.0.0.1:3211/health');
          expect(options.timeoutMs).toBe(250);
          return { statusCode: 200, statusText: 'OK' };
        },
      },
    );
    const unreachable = await probeDevHealthTarget(
      {
        id: 'backend-readiness',
        label: 'Backend readiness',
        url: 'http://127.0.0.1:3211/health/ready',
      },
      {
        request: async () => {
          throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' });
        },
      },
    );

    expect(healthy).toEqual({
      id: 'backend-liveness',
      label: 'Backend liveness',
      url: 'http://127.0.0.1:3211/health',
      ok: true,
      statusCode: 200,
      statusText: 'OK',
    });
    expect(unreachable).toEqual({
      id: 'backend-readiness',
      label: 'Backend readiness',
      url: 'http://127.0.0.1:3211/health/ready',
      ok: false,
      error: 'ConnectionRefused',
    });
  });

  it('uses the local PM2 package before requiring a global executable', () => {
    const command = resolvePm2Command({
      root: 'C:/repo',
      fileExists: (filePath) => filePath.endsWith('node_modules/pm2/bin/pm2'),
      nodePath: 'C:/node/node.exe',
    });

    expect(command).toEqual({
      command: 'C:/node/node.exe',
      argsPrefix: ['C:/repo/node_modules/pm2/bin/pm2'],
      displayName: 'local PM2',
    });
  });

  it('prunes oversized PM2 logs only for the selected instance', () => {
    const pm2Home = mkdtempSync(join(tmpdir(), 'sentris-pm2-'));
    const logDir = join(pm2Home, 'logs');
    mkdirSync(logDir, { recursive: true });

    try {
      const selectedLog = join(logDir, 'sentris-backend-3-out.log');
      const selectedSmallLog = join(logDir, 'sentris-worker-3-error.log');
      const otherInstanceLog = join(logDir, 'sentris-backend-4-out.log');

      writeFileSync(selectedLog, 'x'.repeat(32));
      writeFileSync(selectedSmallLog, 'ok');
      writeFileSync(otherInstanceLog, 'y'.repeat(32));

      const result = prunePm2DevLogs({ instance: 3, pm2Home, maxBytes: 16 });

      expect(statSync(selectedLog).size).toBe(0);
      expect(statSync(selectedSmallLog).size).toBe(2);
      expect(statSync(otherInstanceLog).size).toBe(32);
      expect(result.files).toContainEqual({
        filePath: selectedLog,
        beforeBytes: 32,
        afterBytes: 0,
        pruned: true,
      });
      expect(result.files.find((file) => file.filePath === selectedSmallLog)?.pruned).toBe(false);
    } finally {
      rmSync(pm2Home, { recursive: true, force: true });
    }
  });

  it('creates missing instance env files with scoped runtime values', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentris-instance-env-'));
    try {
      for (const app of ['backend', 'worker', 'frontend']) {
        mkdirSync(join(root, app), { recursive: true });
        writeFileSync(join(root, app, '.env.example'), `CUSTOM_${app.toUpperCase()}=kept\n`, {
          flush: true,
        });
      }

      const result = ensureInstanceEnvFiles({ root, instance: 3 });

      expect(result.files.map((file) => [file.app, file.created])).toEqual([
        ['backend', true],
        ['worker', true],
        ['frontend', true],
      ]);
      expect(existsSync(join(root, '.instances', 'instance-3', 'backend.env'))).toBe(true);

      const backendEnv = readFileSync(join(root, '.instances', 'instance-3', 'backend.env'), 'utf8');
      const workerEnv = readFileSync(join(root, '.instances', 'instance-3', 'worker.env'), 'utf8');
      const frontendEnv = readFileSync(join(root, '.instances', 'instance-3', 'frontend.env'), 'utf8');

      expect(backendEnv).toContain('CUSTOM_BACKEND=kept');
      expect(backendEnv).toContain(
        'DATABASE_URL=postgresql://sentris:sentris@localhost:5433/sentris_instance_3',
      );
      expect(backendEnv).toContain('TEMPORAL_NAMESPACE=sentris-dev-3');
      expect(backendEnv).toContain('TEMPORAL_TASK_QUEUE=sentris-dev-3');
      expect(backendEnv).toContain('PORT=3511');
      expect(workerEnv).toContain('CUSTOM_WORKER=kept');
      expect(workerEnv).toContain('SENTRIS_API_BASE_URL=http://localhost:3511/api/v1');
      expect(frontendEnv).toContain('CUSTOM_FRONTEND=kept');
      expect(frontendEnv).toContain('VITE_API_URL=http://localhost:3511');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('repairs stale instance env values without dropping custom settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'sentris-instance-env-stale-'));
    try {
      for (const app of ['backend', 'worker', 'frontend']) {
        mkdirSync(join(root, app), { recursive: true });
        writeFileSync(join(root, app, '.env.example'), '', { flush: true });
      }

      const instanceDir = join(root, '.instances', 'instance-2');
      ensureInstanceEnvFiles({ root, instance: 2 });
      writeFileSync(
        join(instanceDir, 'backend.env'),
        [
          'CUSTOM_SETTING=keep-me',
          'DATABASE_URL=postgresql://sentris:sentris@localhost:5433/sentris',
          'PORT=3211',
          'TEMPORAL_NAMESPACE=sentris-dev',
          'TEMPORAL_TASK_QUEUE=sentris-dev',
        ].join('\n'),
      );

      const result = ensureInstanceEnvFiles({ root, instance: 2 });
      const backendEnv = readFileSync(join(instanceDir, 'backend.env'), 'utf8');

      expect(result.files.find((file) => file.app === 'backend')?.created).toBe(false);
      expect(backendEnv).toContain('CUSTOM_SETTING=keep-me');
      expect(backendEnv).toContain(
        'DATABASE_URL=postgresql://sentris:sentris@localhost:5433/sentris_instance_2',
      );
      expect(backendEnv).toContain('PORT=3411');
      expect(backendEnv.match(/^DATABASE_URL=/gm)).toHaveLength(1);
      expect(backendEnv.match(/^PORT=/gm)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('parses dev script subcommands without falling back to start', () => {
    expect(parseDevScriptArgs([])).toEqual({ action: 'start', dryRun: false });
    expect(parseDevScriptArgs(['status'])).toEqual({ action: 'status', dryRun: false });
    expect(parseDevScriptArgs(['--', 'status', '--dry-run'])).toEqual({
      action: 'status',
      dryRun: true,
    });
    expect(parseDevScriptArgs(['--help'])).toEqual({ action: 'help', dryRun: false });
    expect(() => parseDevScriptArgs(['wat'])).toThrow('Unknown dev command: wat');
    expect(() => parseDevScriptArgs(['status', 'extra'])).toThrow(
      'Unexpected argument for dev status: extra',
    );
  });

  it('builds cross-platform Bun E2E test commands for the selected instance', () => {
    expect(
      createE2eTestCommand({
        instance: 3,
        targets: ['e2e-tests/core'],
        extraArgs: ['workflow-smoke.test.ts'],
      }),
    ).toEqual({
      command: 'bun',
      args: ['test', '--force-exit', 'e2e-tests/core', 'workflow-smoke.test.ts'],
      env: {
        SENTRIS_INSTANCE: '3',
        RUN_E2E: 'true',
      },
    });
  });

  it('parses E2E env files without requiring shell source', () => {
    expect(
      parseE2eEnvFile(`
        # local keys
        RUN_E2E=true
        export ZAI_API_KEY="zai-secret"
        VIRUSTOTAL_API_KEY='vt-secret'
        EMPTY_VALUE=
      `),
    ).toEqual({
      RUN_E2E: 'true',
      ZAI_API_KEY: 'zai-secret',
      VIRUSTOTAL_API_KEY: 'vt-secret',
      EMPTY_VALUE: '',
    });
  });

  it('reads the documented E2E env file path with an override for custom locations', () => {
    const readFile = (filePath: string) =>
      filePath.endsWith('custom.env') ? 'ABUSEIPDB_API_KEY=abuse-secret\n' : '';

    expect(
      readE2eEnvFile({
        root: 'C:/repo',
        env: { SENTRIS_E2E_ENV_FILE: 'C:/tmp/custom.env' },
        fileExists: (filePath) => filePath.endsWith('custom.env'),
        readFile,
      }),
    ).toEqual({
      filePath: 'C:/tmp/custom.env',
      values: { ABUSEIPDB_API_KEY: 'abuse-secret' },
    });
  });

  it('passes Bun test flags through after E2E targets', () => {
    expect(
      createE2eTestCommand({
        instance: 1,
        targets: ['e2e-tests/core'],
        extraArgs: ['--timeout', '60000'],
      }),
    ).toEqual({
      command: 'bun',
      args: ['test', '--force-exit', 'e2e-tests/core', '--timeout', '60000'],
      env: {
        SENTRIS_INSTANCE: '1',
        RUN_E2E: 'true',
      },
    });
  });

  it('adds cloud E2E environment only for cloud runs', () => {
    expect(
      createE2eTestCommand({
        instance: 2,
        targets: ['e2e-tests/cloud'],
        cloud: true,
      }).env,
    ).toEqual({
      SENTRIS_INSTANCE: '2',
      RUN_E2E: 'true',
      RUN_CLOUD_E2E: 'true',
    });
  });

  it('builds the root test plan without shell-specific chaining', () => {
    expect(createRootTestPlan({ instance: 4 })).toEqual({
      cleanupPaths: ['worker/dist'],
      commands: [
        { command: 'bun', args: ['test', 'packages'] },
        { command: 'bun', args: ['test', 'backend'] },
        { command: 'bun', args: ['test', 'worker'] },
        { command: 'bun', args: ['test', 'e2e-tests'] },
        { command: 'bun', args: ['run', 'test'], cwd: 'frontend' },
      ],
    });
  });

  it('seeds the active template catalog before checking template library verification', () => {
    expect(createTemplateLibraryVerifyPlan()).toEqual({
      commands: [
        {
          command: 'bun',
          args: ['scripts/seed-templates.ts'],
          cwd: 'backend',
        },
        { command: 'bun', args: ['run', 'template-library:check'] },
        {
          command: 'bun',
          args: ['test', 'src/templates/__tests__/seed-templates.spec.ts'],
          cwd: 'backend',
        },
        {
          command: 'bun',
          args: ['test', 'src/templates/__tests__/templates.repository.spec.ts'],
          cwd: 'backend',
        },
        {
          command: 'bun',
          args: ['test', 'src/templates/__tests__/template-seed.service.spec.ts'],
          cwd: 'backend',
        },
        {
          command: 'bun',
          args: ['test', 'scripts/__tests__/template-library-live-audit-utils.test.ts'],
        },
        {
          command: 'bun',
          args: ['test', 'scripts/__tests__/template-seed-script.test.ts'],
        },
      ],
    });
  });

  it('builds the security components verification plan without shell chaining', () => {
    expect(createSecurityComponentsVerifyPlan()).toEqual({
      commands: [
        { command: 'bun', args: ['run', 'security-components:check'] },
        { command: 'bun', args: ['test', 'src/components/security/'], cwd: 'worker' },
        {
          command: 'bun',
          args: ['test', 'src/components/__tests__/security-components-api.spec.ts'],
          cwd: 'backend',
        },
        {
          command: 'bun',
          args: ['test', 'scripts/__tests__/security-component-audit-utils.test.ts'],
        },
        { command: 'bun', args: ['scripts/security-component-docs-check.ts'] },
      ],
    });
  });
});
