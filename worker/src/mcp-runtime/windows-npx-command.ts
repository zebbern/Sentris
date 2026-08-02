import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export interface StdioLaunchCommand {
  command: string;
  args: string[];
}

interface WindowsNpxResolutionOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

/**
 * Avoid the Windows cmd/npx process chain for host-stdio MCP servers.
 *
 * The official MCP server configs wrap npx in `cmd /c` on Windows. Under the
 * Bun-hosted worker that wrapper can keep the disposable v2 negotiation child
 * alive after a legacy probe, so discovery never reaches the real session
 * process. Calling npm's npx CLI through node.exe preserves npm argument
 * semantics without adding shell parsing or another MCP client implementation.
 */
export function resolveWindowsNpxCommand(
  input: StdioLaunchCommand,
  options: WindowsNpxResolutionOptions = {},
): StdioLaunchCommand {
  if ((options.platform ?? process.platform) !== 'win32') return input;
  const npxArgs = unwrapNpxCommand(input);
  if (!npxArgs) return input;

  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const commandDirectory = win32.isAbsolute(input.command)
    ? win32.dirname(input.command)
    : undefined;
  const pathDirectories = (env.PATH ?? env.Path ?? env.path ?? '')
    .split(';')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  const nodeDirectories = unique([
    commandDirectory,
    ...pathDirectories,
    env.ProgramFiles ? win32.join(env.ProgramFiles, 'nodejs') : undefined,
    env.PROGRAMFILES ? win32.join(env.PROGRAMFILES, 'nodejs') : undefined,
  ]);
  const npmDirectories = unique([
    commandDirectory,
    ...pathDirectories,
    env.APPDATA ? win32.join(env.APPDATA, 'npm') : undefined,
    env.AppData ? win32.join(env.AppData, 'npm') : undefined,
  ]);
  const nodeExecutable = nodeDirectories
    .map((directory) => win32.join(directory, 'node.exe'))
    .find(exists);
  const npxCli = npmDirectories
    .map((directory) => win32.join(directory, 'node_modules', 'npm', 'bin', 'npx-cli.js'))
    .find(exists);
  if (!nodeExecutable || !npxCli) return input;

  return { command: nodeExecutable, args: [npxCli, ...npxArgs] };
}

function unwrapNpxCommand(input: StdioLaunchCommand): string[] | undefined {
  const command = win32.basename(input.command).toLowerCase();
  if (command === 'npx' || command === 'npx.cmd') return [...input.args];
  if (command !== 'cmd' && command !== 'cmd.exe') return undefined;
  if (input.args[0]?.toLowerCase() !== '/c') return undefined;
  const wrappedCommand = input.args[1];
  if (!wrappedCommand) return undefined;
  const wrappedName = win32.basename(wrappedCommand).toLowerCase();
  if (wrappedName !== 'npx' && wrappedName !== 'npx.cmd') return undefined;
  return input.args.slice(2);
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
