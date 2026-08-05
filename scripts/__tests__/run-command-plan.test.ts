import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

import * as commandPlanModule from '../lib/run-command-plan';

const { resolveCommandExecutable, runCommandStep } =
  commandPlanModule as typeof commandPlanModule & {
    resolveCommandExecutable: (
      command: string,
      options?: {
        bunExecutable?: string | null;
        env?: NodeJS.ProcessEnv;
        fileExists?: (path: string) => boolean;
        platform?: NodeJS.Platform;
      },
    ) => string;
    runCommandStep: (step: {
      command: string;
      args: string[];
      timeoutMs: number;
      progressIntervalMs?: number;
    }) => Promise<number>;
  };

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function forceCleanupProcessTree(processId: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(processId), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-processId, 'SIGKILL');
  } catch {
    try {
      process.kill(processId, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

describe('command plan lifecycle', () => {
  it('reuses the Bun executable that launched the package script', () => {
    const packageBun = 'C:\\tools\\bun\\bin\\bun.exe';

    expect(
      resolveCommandExecutable('bun', {
        bunExecutable: null,
        env: { npm_execpath: packageBun },
      }),
    ).toBe(packageBun);
    expect(
      resolveCommandExecutable('node', {
        bunExecutable: 'C:\\other\\bun.exe',
        env: { npm_execpath: packageBun },
      }),
    ).toBe('node');
  });

  it('resolves the npm Bun shim target before a later standalone Bun on Windows', () => {
    const npmDirectory = 'C:\\tools\\npm';
    const standaloneDirectory = 'C:\\tools\\standalone-bun';
    const npmBun = join(npmDirectory, 'node_modules', 'bun', 'bin', 'bun.exe');
    const standaloneBun = join(standaloneDirectory, 'bun.exe');

    expect(
      resolveCommandExecutable('bun', {
        bunExecutable: null,
        env: { Path: `${npmDirectory};${standaloneDirectory}` },
        fileExists: (candidate) => candidate === npmBun || candidate === standaloneBun,
        platform: 'win32',
      }),
    ).toBe(npmBun);
  });

  it('times out a command and terminates its descendant process tree', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sentris-command-plan-'));
    const childPidPath = join(directory, 'child.pid');
    const script = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join(' ');
    let childProcessId: number | undefined;

    try {
      const status = await runCommandStep({
        command: process.execPath,
        args: ['-e', script],
        timeoutMs: 500,
        progressIntervalMs: 0,
      });
      expect(status).toBe(124);
      expect(existsSync(childPidPath)).toBe(true);
      childProcessId = Number(readFileSync(childPidPath, 'utf8'));
      expect(Number.isInteger(childProcessId)).toBe(true);
      expect(isProcessAlive(childProcessId)).toBe(false);
    } finally {
      if (childProcessId && isProcessAlive(childProcessId)) {
        forceCleanupProcessTree(childProcessId);
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
