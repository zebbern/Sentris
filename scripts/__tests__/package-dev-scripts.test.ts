import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'bun:test';

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const backendPackageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'backend', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> };
const workerPackageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'worker', 'package.json'), 'utf8'),
) as { scripts: Record<string, string> };
const require = createRequire(import.meta.url);

type CommandPlanStep = { command: string; args: string[]; cwd?: string };

function parseDryRunPlan(scriptPath: string): CommandPlanStep[] {
  const result = spawnSync(process.execPath, [scriptPath, '--dry-run'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  return (JSON.parse(result.stdout) as { commands: CommandPlanStep[] }).commands;
}

function withTemporaryActiveInstanceCli(
  fn: (paths: { root: string; scriptPath: string; markerPath: string }) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sentris-active-instance-cli-'));
  const scriptDir = join(root, 'scripts');
  const libDir = join(scriptDir, 'lib');

  try {
    mkdirSync(libDir, { recursive: true });
    copyFileSync(
      join(process.cwd(), 'scripts', 'active-instance.js'),
      join(scriptDir, 'active-instance.js'),
    );
    copyFileSync(
      join(process.cwd(), 'scripts', 'lib', 'dev-instance-runtime.js'),
      join(libDir, 'dev-instance-runtime.js'),
    );

    fn({
      root,
      scriptPath: join(scriptDir, 'active-instance.js'),
      markerPath: join(root, '.sentris-instance'),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('package development scripts', () => {
  it('keeps legacy dev aliases on the instance-aware cross-platform scripts', () => {
    expect(packageJson.scripts['dev:infra']).toBe('bun run dev');
    expect(packageJson.scripts['dev:stack']).toBe('bun run dev');
    expect(packageJson.scripts['dev:stack:stop']).toBe('bun run dev:stop');
  });

  it('exposes a cross-platform active instance command', () => {
    expect(packageJson.scripts.instance).toBe('node scripts/active-instance.js');
    expect(packageJson.scripts.instance).not.toContain('active-instance.sh');
    expect(packageJson.scripts.instance).not.toContain('bash');
  });

  it('active instance CLI shows environment overrides without modifying the marker', () => {
    withTemporaryActiveInstanceCli(({ root, scriptPath, markerPath }) => {
      writeFileSync(markerPath, '2\n');
      const result = spawnSync(process.execPath, [scriptPath, 'show'], {
        cwd: root,
        env: { ...process.env, SENTRIS_INSTANCE: '5' },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('5');
      expect(readFileSync(markerPath, 'utf8')).toBe('2\n');
    });
  });

  it('active instance CLI writes and validates the workspace marker', () => {
    withTemporaryActiveInstanceCli(({ root, scriptPath, markerPath }) => {
      const setResult = spawnSync(process.execPath, [scriptPath, 'use', '3'], {
        cwd: root,
        env: { ...process.env, SENTRIS_INSTANCE: '' },
        encoding: 'utf8',
      });
      const invalidResult = spawnSync(process.execPath, [scriptPath, 'use', 'dev'], {
        cwd: root,
        env: { ...process.env, SENTRIS_INSTANCE: '' },
        encoding: 'utf8',
      });

      expect(setResult.status).toBe(0);
      expect(setResult.stdout.trim()).toBe('Active instance set to 3');
      expect(readFileSync(markerPath, 'utf8')).toBe('3\n');
      expect(invalidResult.status).toBe(1);
      expect(invalidResult.stderr).toContain('instance must be an integer from 0 to 9');
      expect(readFileSync(markerPath, 'utf8')).toBe('3\n');
    });
  });

  it('routes bun dev subcommands without falling back to full-stack start', () => {
    const result = spawnSync('bun', ['run', 'dev', '--', 'status', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"action": "status"');
    expect(result.stdout).not.toContain('Starting Sentris Flow');
  });

  it('rejects unknown bun dev subcommands before startup', () => {
    const result = spawnSync('bun', ['run', 'dev', '--', 'unknown-command', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown dev command: unknown-command');
    expect(result.stdout).not.toContain('Starting Sentris Flow');
  });

  it('keeps dev:stop as a compatibility wrapper around the shared dev command router', () => {
    const devStopScript = readFileSync(join(process.cwd(), 'scripts/dev-stop.js'), 'utf8');

    expect(devStopScript).toContain("'dev.js'");
    expect(devStopScript).toContain("'stop'");
    expect(devStopScript).not.toContain('pm2');
    expect(devStopScript).not.toContain('docker compose');
    expect(devStopScript).not.toContain('execSync');
  });

  it('does not keep hardcoded instance-0 PM2 orchestration in package scripts', () => {
    const staleScripts = Object.entries(packageJson.scripts).filter(([, command]) =>
      /sentris-(frontend|backend|worker)-0|pm2 startOrReload|pm2 delete/.test(command),
    );

    expect(staleScripts).toEqual([]);
  });

  it('keeps E2E scripts cross-platform without bash or shell-only instance lookup', () => {
    const e2eScripts = Object.entries(packageJson.scripts).filter(([name]) =>
      name.startsWith('test:e2e'),
    );

    expect(e2eScripts).not.toEqual([]);
    for (const [, command] of e2eScripts) {
      expect(command).not.toContain('bash -lc');
      expect(command).not.toContain('active-instance.sh');
    }
    expect(packageJson.scripts['test:e2e']).toBe('node scripts/e2e-test.js e2e-tests');
    expect(packageJson.scripts['test:e2e:cloud']).toBe(
      'node scripts/e2e-test.js --cloud e2e-tests/cloud',
    );
  });

  it('keeps the root test script cross-platform while live E2E stays explicit', () => {
    expect(packageJson.scripts.test).toBe('node scripts/test-all.js');
    expect(packageJson.scripts.test).not.toContain('rm -rf');
    expect(packageJson.scripts.test).not.toContain('&&');
    expect(packageJson.scripts.test).not.toContain('bun test e2e-tests');
  });

  it('uses build-mode typecheck for packages with TypeScript project references', () => {
    expect(packageJson.scripts.typecheck).toBe('tsc --build');
    expect(backendPackageJson.scripts.typecheck).toBe('tsc --build');
    expect(workerPackageJson.scripts.typecheck).toBe('tsc --build');
  });

  it('keeps template and security verification scripts off shell chaining', () => {
    expect(packageJson.scripts['template-library:verify']).toBe(
      'node scripts/verify-template-library.js',
    );
    expect(packageJson.scripts['security-components:verify']).toBe(
      'node scripts/verify-security-components.js',
    );
    expect(packageJson.scripts['template-library:verify']).not.toContain('&&');
    expect(packageJson.scripts['security-components:verify']).not.toContain('&&');
  });

  it('keeps verification dry-runs focused and free of direct live audit commands', () => {
    const templatePlan = parseDryRunPlan('scripts/verify-template-library.js');
    const securityPlan = parseDryRunPlan('scripts/verify-security-components.js');
    const allSteps = [...templatePlan, ...securityPlan];

    expect(templatePlan).toContainEqual({
      command: 'bun',
      args: ['run', 'template-library:check'],
    });
    expect(securityPlan).toContainEqual({
      command: 'bun',
      args: ['run', 'security-components:check'],
    });

    for (const step of allSteps) {
      const commandLine = [step.command, ...step.args].join(' ');
      expect(commandLine).not.toContain('template-library:audit');
      expect(commandLine).not.toContain('security-components:audit');
      expect(commandLine).not.toContain('test:e2e');
      expect(commandLine).not.toBe('bun run test');
    }
  });

  it('rejects unknown verification runner options before running command plans', () => {
    const templateResult = spawnSync(
      process.execPath,
      ['scripts/verify-template-library.js', '--unknown'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );
    const securityResult = spawnSync(
      process.execPath,
      ['scripts/verify-security-components.js', '--unknown'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(templateResult.status).toBe(1);
    expect(templateResult.stderr).toContain(
      'Unknown template library verification runner option: --unknown',
    );
    expect(securityResult.status).toBe(1);
    expect(securityResult.stderr).toContain(
      'Unknown security components verification runner option: --unknown',
    );
  });

  it('restarts backend dev when template validation dependencies change', () => {
    const pm2Config = require(join(process.cwd(), 'pm2.config.cjs')) as {
      apps: Array<{ name: string; watch: false | string[] }>;
    };
    const backendApp = pm2Config.apps.find((app) => app.name.startsWith('sentris-backend-'));

    expect(backendApp?.watch).toEqual(expect.arrayContaining(['src', 'scripts/seed-templates']));
    expect(
      Array.isArray(backendApp?.watch) &&
        backendApp.watch.some((watchPath) =>
          watchPath.replace(/\\/g, '/').endsWith('/packages/shared/src'),
        ),
    ).toBe(true);
  });

  it('does not restart runtime dev apps when source test files change', () => {
    const pm2Config = require(join(process.cwd(), 'pm2.config.cjs')) as {
      apps: Array<{ name: string; ignore_watch?: string[] }>;
    };
    const runtimeApps = pm2Config.apps.filter((app) =>
      /^sentris-(frontend|backend|worker)-/.test(app.name),
    );

    expect(runtimeApps.length).toBe(3);
    for (const app of runtimeApps) {
      expect(app.ignore_watch).toEqual(
        expect.arrayContaining(['__tests__', '*.test.ts', '*.spec.ts']),
      );
    }
  });

  it('rejects unknown E2E runner options before forwarding Bun test args', () => {
    const result = spawnSync(process.execPath, ['scripts/e2e-test.js', '--unknown', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown E2E runner option: --unknown');
  });

  it('loads E2E env files during dry-run without printing secret values', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'sentris-e2e-env-'));
    const envFile = join(tempDir, '.env.e2e');
    writeFileSync(envFile, 'ZAI_API_KEY=super-secret-zai\nVIRUSTOTAL_API_KEY=super-secret-vt\n');

    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/e2e-test.js', 'e2e-tests/core', '--dry-run'],
        {
          cwd: process.cwd(),
          env: { ...process.env, SENTRIS_E2E_ENV_FILE: envFile },
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"loadedEnvKeys":["VIRUSTOTAL_API_KEY","ZAI_API_KEY"]');
      expect(result.stdout).not.toContain('super-secret');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('honors E2E_INSTANCE as a legacy fallback in the E2E runner dry-run', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/e2e-test.js', 'e2e-tests/core', '--dry-run'],
      {
        cwd: process.cwd(),
        env: { ...process.env, SENTRIS_INSTANCE: '', E2E_INSTANCE: '3' },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running E2E tests for instance 3');
    expect(result.stdout).toContain('"SENTRIS_INSTANCE":"3"');
  });

  it('rejects unknown root test runner options instead of ignoring them', () => {
    const result = spawnSync(process.execPath, ['scripts/test-all.js', '--unknown', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown root test runner option: --unknown');
  });
});
