import { describe, expect, test } from 'bun:test';
import { win32 } from 'node:path';

import { resolveWindowsNpxCommand } from '../windows-npx-command';

const nodeDirectory = 'C:\\Program Files\\nodejs';
const nodeExecutable = win32.join(nodeDirectory, 'node.exe');
const npxCli = win32.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js');
const existingPaths = new Set([win32.normalize(nodeExecutable), win32.normalize(npxCli)]);
const options = {
  platform: 'win32' as const,
  env: { PATH: nodeDirectory },
  exists: (path: string) => existingPaths.has(win32.normalize(path)),
};

describe('resolveWindowsNpxCommand', () => {
  test('normalizes the official Windows cmd /c npx form without shell parsing', () => {
    expect(
      resolveWindowsNpxCommand(
        {
          command: 'cmd',
          args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-everything@2026.7.4'],
        },
        options,
      ),
    ).toEqual({
      command: nodeExecutable,
      args: [npxCli, '-y', '@modelcontextprotocol/server-everything@2026.7.4'],
    });
  });

  test('normalizes a direct npx command and preserves every configured argument', () => {
    expect(
      resolveWindowsNpxCommand(
        { command: 'npx', args: ['--offline', '-y', 'server-package', '--flag=value'] },
        options,
      ),
    ).toEqual({
      command: nodeExecutable,
      args: [npxCli, '--offline', '-y', 'server-package', '--flag=value'],
    });
  });

  test('leaves unrelated commands and non-Windows launchers unchanged', () => {
    const unrelated = { command: 'python', args: ['-m', 'mcp_server'] };
    expect(resolveWindowsNpxCommand(unrelated, options)).toBe(unrelated);
    expect(
      resolveWindowsNpxCommand(
        { command: 'npx', args: ['server-package'] },
        { ...options, platform: 'linux' },
      ),
    ).toEqual({ command: 'npx', args: ['server-package'] });
  });

  test('keeps the configured launcher when node or the npm CLI cannot be resolved', () => {
    const input = { command: 'cmd', args: ['/c', 'npx', '-y', 'server-package'] };
    expect(resolveWindowsNpxCommand(input, { ...options, exists: () => false })).toBe(input);
  });
});
