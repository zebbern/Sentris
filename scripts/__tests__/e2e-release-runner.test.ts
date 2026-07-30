import { describe, expect, it } from 'bun:test';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function runnerEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    ...extra,
  };
}

describe('release E2E runner', () => {
  it('rejects an active-instance file when release mode requires an explicit instance', () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        'scripts/e2e-test.js',
        '--require-explicit-instance',
        '--dry-run',
        'e2e-tests/core/self-hosted-critical-journey.test.ts',
      ],
      {
        cwd: root,
        env: runnerEnvironment(),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain(
      'SENTRIS_INSTANCE must be set explicitly',
    );
  });

  it('runs the same release target when SENTRIS_INSTANCE is explicit', () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        'scripts/e2e-test.js',
        '--require-explicit-instance',
        '--strict-services',
        '--dry-run',
        'e2e-tests/core/self-hosted-critical-journey.test.ts',
      ],
      {
        cwd: root,
        env: runnerEnvironment({ SENTRIS_INSTANCE: '2' }),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(result.exitCode).toBe(0);
    expect(output).toContain('Running E2E tests for instance 2');
    expect(output).toContain('"SENTRIS_INSTANCE":"2"');
    expect(output).toContain('"E2E_STRICT_SERVICES":"true"');
  });

  it('turns an unavailable strict service preflight into a failing test', () => {
    const result = Bun.spawnSync(
      [process.execPath, 'test', 'e2e-tests/core/self-hosted-critical-journey.test.ts'],
      {
        cwd: root,
        env: runnerEnvironment({
          RUN_E2E: 'true',
          E2E_STRICT_SERVICES: 'true',
          E2E_API_BASE_URL: 'http://127.0.0.1:1/api/v1',
          E2E_INTERNAL_SERVICE_TOKEN: 'strict-preflight-test-token',
        }),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(result.exitCode).toBe(1);
    expect(output).toContain('Strict E2E service preflight failed');
    expect(output).toContain('refusing to skip release tests');
  });
});
