import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, access, constants } from 'fs/promises';

import type { ExecutionContext, RunnerConfig, DockerRunnerConfig } from './types';
import { createTerminalChunkEmitter } from './terminal';
import { ContainerError, TimeoutError, ValidationError, ConfigurationError } from './errors';
import { createDockerIoWorkspace } from './docker-io-workspace';
import { createManagedDockerLabels, resolveDockerResourceScope } from './docker-resource-scope';

/**
 * Strip ANSI escape codes from text.
 * Docker containers and PTY output often contain color/control codes
 * that pollute structured output (JSON parsing, line splitting).
 */
export function stripAnsiCodes(text: string): string {
  return text
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

// Standard output file path inside the container
const CONTAINER_OUTPUT_PATH = '/sentris-output';
const OUTPUT_FILENAME = 'result.json';

type PtySpawn = (typeof import('node-pty'))['spawn'];
let cachedPtySpawn: PtySpawn | null = null;
let cachedDockerPath: string | null = null;

function cancellationReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Execution cancelled');
}

function throwIfCancelled(context: ExecutionContext): void {
  if (context.signal?.aborted) {
    throw cancellationReason(context.signal);
  }
}

export async function resolveDockerPath(context?: ExecutionContext): Promise<string> {
  if (cachedDockerPath) return cachedDockerPath;

  const commonPaths = [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/usr/bin/docker',
    '/bin/docker',
  ];

  for (const path of commonPaths) {
    try {
      await access(path, constants.X_OK);
      context?.logger.debug(`[Docker] Resolved docker path to: ${path}`);
      cachedDockerPath = path;
      return path;
    } catch {
      // Continue to next path
    }
  }

  // Fallback to searching in PATH
  context?.logger.info(
    `[Docker] Checked common paths but could not find docker. Fallback to using "docker" from PATH.`,
  );
  cachedDockerPath = 'docker';
  return 'docker';
}

/**
 * Detect Docker image pull progress messages that are sent to stderr
 * but are informational, not actual errors.
 */
const DOCKER_PROGRESS_PATTERNS = [
  /^(Pulling|Waiting|Downloading|Extracting|Verifying|Pull complete|Download complete|Already exists)/i,
  /^[0-9a-f]{12}:\s*(Pulling|Waiting|Downloading|Extracting|Verifying|Pull complete|Download complete|Already exists)/i,
  /^Digest:\s*sha256:/i,
  /^Status:\s*(Downloaded|Image is up to date)/i,
  /^[0-9a-f]{12}:\s*(Pulling fs layer|Download complete|Pull complete)/i,
];

function isDockerProgressMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  return DOCKER_PROGRESS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function formatArgs(args: string[]): string {
  return args
    .map((part, index) => {
      if (!part) {
        return '';
      }
      const previous = index > 0 ? args[index - 1] : undefined;
      if (previous === '-e' && part.includes('=')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex > 0) {
          return `${part.slice(0, separatorIndex + 1)}***`;
        }
      }
      const hasNewlines = part.includes('\n');
      const isLong = part.length > 120;
      if (hasNewlines || isLong) {
        return `<arg-${index}:${part.length} chars>`;
      }
      return part;
    })
    .join(' ');
}

/**
 * Inject container env vars via the Docker spawn process environment (`-e KEY` without inline values).
 * Avoids shell/docker CLI parsing issues for secrets containing `#`, spaces, or quotes.
 */
export function applyDockerContainerEnv(
  dockerArgs: string[],
  containerEnv: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

  for (const [key, rawValue] of Object.entries(containerEnv)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    spawnEnv[key] = String(rawValue);
    dockerArgs.push('-e', key);
  }

  return spawnEnv;
}

async function loadPtySpawn(): Promise<PtySpawn | null> {
  if (cachedPtySpawn) {
    return cachedPtySpawn;
  }
  try {
    const mod = await import('node-pty');
    cachedPtySpawn = mod.spawn;
    return cachedPtySpawn;
  } catch (error) {
    console.warn(
      '[Docker][PTY] node-pty module not available:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function runDockerSetupCommand(
  args: string[],
  context: ExecutionContext,
  timeoutSeconds: number,
): Promise<{ stdout: string; stderr: string }> {
  throwIfCancelled(context);
  const dockerPath = await resolveDockerPath(context);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(dockerPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const onAbort = () => {
      clearTimeout(timeout);
      proc.kill();
      reject(cancellationReason(context.signal!));
    };
    const timeout = setTimeout(() => {
      proc.kill();
      reject(
        new TimeoutError(
          `Docker setup command timed out after ${timeoutSeconds}s`,
          timeoutSeconds * 1000,
          { details: { dockerArgs: formatArgs(args) } },
        ),
      );
    }, timeoutSeconds * 1000);
    context.signal?.addEventListener('abort', onAbort, { once: true });
    if (context.signal?.aborted) onAbort();

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
      reject(
        new ContainerError(`Failed to run Docker setup command: ${error.message}`, {
          cause: error,
          details: { dockerArgs: formatArgs(args) },
        }),
      );
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
      if (context.signal?.aborted) {
        reject(cancellationReason(context.signal));
        return;
      }
      if (code !== 0) {
        reject(
          new ContainerError(`Docker setup command failed with exit code ${code}`, {
            details: { exitCode: code, stdout, stderr, dockerArgs: formatArgs(args) },
          }),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function ensureDockerImageAvailable(
  runner: DockerRunnerConfig,
  context: ExecutionContext,
): Promise<void> {
  const setupTimeoutSeconds = Math.max(300, runner.timeoutSeconds ?? 300);
  const inspectArgs = ['image', 'inspect', runner.image];

  try {
    await runDockerSetupCommand(inspectArgs, context, setupTimeoutSeconds);
    return;
  } catch {
    throwIfCancelled(context);
    context.emitProgress(`Pulling Docker image: ${runner.image}`);
  }

  const pullArgs = ['pull'];
  if (runner.platform && runner.platform.trim().length > 0) {
    pullArgs.push('--platform', runner.platform);
  }
  pullArgs.push(runner.image);

  try {
    await runDockerSetupCommand(pullArgs, context, setupTimeoutSeconds);
  } catch (error) {
    throwIfCancelled(context);
    throw new ContainerError(`Failed to pull Docker image: ${runner.image}`, {
      cause: error instanceof Error ? error : undefined,
      details: { image: runner.image },
    });
  }
}

export async function runComponentInline<I, O>(
  execute: (params: I, context: ExecutionContext) => Promise<O>,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  return execute(params, context);
}

/**
 * Execute a component in a Docker container
 * - Starts container with specified image and command
 * - Mounts a temp directory for structured output at /sentris-output
 * - Components should write results to /sentris-output/result.json
 * - Stdout/stderr are used purely for logging/progress
 * - Automatically cleans up container and temp directory on exit
 */
async function runComponentInDocker<I, O>(
  runner: DockerRunnerConfig,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  throwIfCancelled(context);
  const {
    image,
    command,
    entrypoint,
    env = {},
    network = 'none',
    platform,
    containerName,
    volumes,
    timeoutSeconds = 300,
    detached,
  } = runner;
  const memoryLimit = runner.memoryLimit ?? '512m';
  const cpuLimit = runner.cpuLimit ?? '1';
  const pidsLimit = runner.pidsLimit ?? 256;
  const resourceScope = resolveDockerResourceScope();
  const effectiveContainerName =
    containerName ?? `sentris-component-${randomUUID().replaceAll('-', '')}`;

  context.logger.info(`[Docker] Running ${image} with command: ${formatArgs(command)}`);
  context.emitProgress(`Starting Docker container: ${image}`);

  // A local daemon can mount the worker's OS temp directory directly. The
  // production DIND topology configures an identical path backed by an outer
  // named volume mounted into both worker and daemon, so the inner container
  // never depends on a worker-host-only path.
  const ioWorkspace = await createDockerIoWorkspace({
    runId: context.runId,
    sharedRoot: process.env.SENTRIS_DOCKER_SHARED_IO_ROOT,
    resourceScope,
  });
  const outputDir = ioWorkspace.mountSource;
  const hostOutputPath = ioWorkspace.outputPath;
  const hostInputPath = ioWorkspace.inputPath;

  try {
    // Write inputs to file instead of passing via env or stdin
    await writeFile(hostInputPath, JSON.stringify(params));
    await ensureDockerImageAvailable(runner, context);
    throwIfCancelled(context);

    const dockerArgs = [
      'run',
      '--rm',
      '-i',
      '--network',
      network,
      '--memory',
      memoryLimit,
      '--cpus',
      cpuLimit,
      '--pids-limit',
      String(pidsLimit),
      ...Object.entries(createManagedDockerLabels(context.runId, resourceScope)).flatMap(
        ([key, value]) => ['--label', `${key}=${value}`],
      ),
      '--label',
      `sentris.nodeRef=${context.componentRef}`,
      '--label',
      `sentris.ioResource=${ioWorkspace.resourceId}`,
      '--name',
      effectiveContainerName,
      // Mount the directory containing both input and output
      '-v',
      `${outputDir}:${CONTAINER_OUTPUT_PATH}`,
    ];

    if (platform && platform.trim().length > 0) {
      dockerArgs.push('--platform', platform);
    }

    if (Array.isArray(volumes)) {
      for (const vol of volumes) {
        if (!vol || !vol.source || !vol.target) continue;
        const mode = vol.readOnly ? ':ro' : '';
        dockerArgs.push('-v', `${vol.source}:${vol.target}${mode}`);
      }
    }

    if (runner.ports) {
      for (const [hostPort, containerPort] of Object.entries(runner.ports)) {
        dockerArgs.push(
          '-p',
          hostPort === 'auto' ? String(containerPort) : `${hostPort}:${containerPort}`,
        );
      }
    }

    const spawnEnv = applyDockerContainerEnv(dockerArgs, {
      ...env,
      SENTRIS_INPUT_PATH: `${CONTAINER_OUTPUT_PATH}/input.json`,
      SENTRIS_OUTPUT_PATH: `${CONTAINER_OUTPUT_PATH}/${OUTPUT_FILENAME}`,
    });

    if (entrypoint) {
      dockerArgs.push('--entrypoint', entrypoint);
    }

    dockerArgs.push(image, ...command);

    const useTerminal = Boolean(context.terminalCollector);
    let capturedStdout = '';

    if (runner.detached) {
      // For detached mode, we use -d instead of -i and return the container ID
      const detachedArgs = dockerArgs.map((arg) => (arg === '-i' ? '-d' : arg));
      if (!detachedArgs.includes('-d')) {
        detachedArgs.splice(1, 0, '-d');
      }

      // In detached mode, keep --rm only when explicitly requested
      const persistentArgs = runner.autoRemove
        ? detachedArgs
        : detachedArgs.filter((arg) => arg !== '--rm');

      capturedStdout = await runDockerWithStandardIO(
        persistentArgs,
        params,
        context,
        timeoutSeconds,
        runner.stdinJson,
        true,
        spawnEnv,
        effectiveContainerName,
      );

      // In detached mode, we return the container ID as part of a specialized output
      return {
        containerId: capturedStdout.trim(),
        status: 'running',
        endpoint: env.ENDPOINT || `http://localhost:${env.PORT || 8080}`,
      } as unknown as O;
    }

    if (useTerminal) {
      // Remove -i flag for PTY mode (stdin not needed with TTY)
      const argsWithoutStdin = dockerArgs.filter((arg) => arg !== '-i');
      if (!argsWithoutStdin.includes('-t')) {
        argsWithoutStdin.splice(2, 0, '-t');
      }
      // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
      capturedStdout = await runDockerWithPty(
        argsWithoutStdin,
        params,
        context,
        timeoutSeconds,
        spawnEnv,
        effectiveContainerName,
      );
    } else {
      capturedStdout = await runDockerWithStandardIO(
        dockerArgs,
        params,
        context,
        timeoutSeconds,
        runner.stdinJson,
        false,
        spawnEnv,
        effectiveContainerName,
      );
    }

    // Read output from file (with stdout fallback for legacy components)
    return await readOutputFromFile<O>(hostOutputPath, capturedStdout, context);
  } finally {
    await ioWorkspace.cleanup().catch((err) => {
      context.logger.warn(`[Docker] Failed to cleanup temp directory ${outputDir}: ${err.message}`);
    });
  }
}

/**
 * Read component output from the mounted output file.
 * If file doesn't exist, falls back to stdout parsing for backwards compatibility.
 *
 * @param filePath Path to the output file
 * @param stdout Captured stdout as fallback for legacy components
 * @param context Execution context for logging
 */
async function readOutputFromFile<O>(
  filePath: string,
  stdout: string,
  context: ExecutionContext,
): Promise<O> {
  // First, try to read from the output file (preferred method)
  try {
    await access(filePath, constants.R_OK);
    const content = await readFile(filePath, 'utf8');
    const output = JSON.parse(content.trim());
    context.logger.info(`[Docker] Read output from file (${content.length} bytes)`);
    return output as O;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        context.logger.error(`[Docker] Failed to parse output JSON: ${error.message}`);
        throw new ValidationError(`Failed to parse container output as JSON: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    // File not found - fall through to stdout fallback
  }

  // Fallback: Use stdout (for backwards compatibility with legacy components)
  // This allows components that just write to stdout to continue working.
  if (stdout.trim().length > 0) {
    // Strip ANSI escape codes before parsing — Docker/PTY output often contains
    // color codes that break JSON parsing and pollute line-based output.
    const cleanStdout = stripAnsiCodes(stdout);
    context.logger.info(
      `[Docker] No output file found, using stdout fallback (${cleanStdout.length} bytes)`,
    );

    // Try to parse stdout as JSON
    try {
      const output = JSON.parse(cleanStdout.trim());
      return output as O;
    } catch {
      // Not JSON - return raw string as output
      // This handles components like subfinder that output plain text
      return cleanStdout.trim() as unknown as O;
    }
  }

  // No output file and no stdout - return empty object
  context.logger.warn('[Docker] No output file or stdout, returning empty result');
  return {} as O;
}

/**
 * Run Docker container with standard I/O.
 * Stdout/stderr are collected - stdout is returned for backwards compatibility.
 * Primary output method is the mounted output file.
 */
async function runDockerWithStandardIO<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
  stdinJson?: boolean,
  detached?: boolean,
  spawnEnv: NodeJS.ProcessEnv = process.env,
  containerName?: string,
): Promise<string> {
  throwIfCancelled(context);
  const dockerPath = await resolveDockerPath(context);
  return new Promise<string>((resolve, reject) => {
    const stdoutEmitter = createTerminalChunkEmitter(context, 'stdout');
    const stderrEmitter = createTerminalChunkEmitter(context, 'stderr');
    let settled = false;
    const proc = spawn(dockerPath, dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
    });
    const cleanupContainer = async () => {
      if (!containerName) return;
      await removeDockerContainerAfterInterrupt(containerName, context).catch((error) => {
        context.logger.warn(
          `[Docker] Failed to remove cancelled container ${containerName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    };
    const rejectAfterCleanup = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
      proc.kill();
      void cleanupContainer().finally(() => reject(error));
    };
    const onAbort = () => rejectAfterCleanup(cancellationReason(context.signal!));
    const timeout = setTimeout(() => {
      rejectAfterCleanup(
        new TimeoutError(
          `Docker container timed out after ${timeoutSeconds}s`,
          timeoutSeconds * 1000,
          {
            details: { dockerArgs: formatArgs(dockerArgs) },
          },
        ),
      );
    }, timeoutSeconds * 1000);
    context.signal?.addEventListener('abort', onAbort, { once: true });
    if (context.signal?.aborted) onAbort();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdoutEmitter(data);
      const chunk = data.toString();
      stdout += chunk; // Capture for fallback

      // Send to log collector (which has chunking support)
      const logEntry = {
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stdout' as const,
        level: 'info' as const,
        message: chunk,
        timestamp: new Date().toISOString(),
      };
      context.logCollector?.(logEntry);

      // NOTE: We intentionally do NOT emit stdout as trace progress events.
      // Output data is written to /sentris-output/result.json by the container.
      // Stdout should only contain logs and progress messages from the component.
    });

    proc.stderr.on('data', (data) => {
      stderrEmitter(data);
      const chunk = data.toString();
      stderr += chunk;
      const isProgress = isDockerProgressMessage(chunk);
      const level = isProgress ? ('info' as const) : ('error' as const);
      const logEntry = {
        runId: context.runId,
        nodeRef: context.componentRef,
        stream: 'stderr' as const,
        level,
        message: chunk,
        timestamp: new Date().toISOString(),
      };

      context.logCollector?.(logEntry);
      // Only emit actual error messages as progress, not raw data
      if (chunk.trim().length > 0 && chunk.trim().length < 500) {
        context.emitProgress({
          message: chunk.trim(),
          level,
          data: { stream: 'stderr', origin: 'docker' },
        });
      }

      if (!isProgress) {
        console.error(`[${context.componentRef}] [Docker] stderr: ${chunk.trim()}`);
      }
    });

    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
      context.logger.error(`[Docker] Failed to start: ${error.message}`);
      reject(
        new ContainerError(`Failed to start Docker container: ${error.message}`, {
          cause: error,
          details: { dockerArgs: formatArgs(dockerArgs) },
        }),
      );
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);

      if (code !== 0) {
        context.logger.error(`[Docker] Exited with code ${code}`);
        context.logger.error(`[Docker] stderr: ${stderr}`);

        // Emit error to UI
        context.emitProgress({
          message: `Docker container failed with exit code ${code}`,
          level: 'error',
          data: { exitCode: code, stderr: stderr.slice(0, 500) },
        });

        reject(
          new ContainerError(`Docker container failed with exit code ${code}: ${stderr}`, {
            details: { exitCode: code, stderr, stdout, dockerArgs: formatArgs(dockerArgs) },
          }),
        );
        return;
      }

      context.logger.info(`[Docker] Completed successfully`);
      context.emitProgress('Docker container completed');

      // Return captured stdout for fallback processing
      resolve(stdout);
    });

    if (stdinJson !== false) {
      // Only write JSON to stdin if stdinJson is true or undefined (default behavior)
      try {
        const input = JSON.stringify(params);
        proc.stdin.write(input);
        proc.stdin.end();
      } catch (e) {
        rejectAfterCleanup(
          new ValidationError(`Failed to write input to Docker container: ${e}`, {
            cause: e as Error,
            details: { inputType: typeof params },
          }),
        );
      }
    } else {
      // Close stdin immediately if stdinJson is false
      proc.stdin.end();
    }
  });
}

async function runDockerCleanupCommand(args: string[], context: ExecutionContext): Promise<void> {
  const dockerPath = await resolveDockerPath(context);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(dockerPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Docker cleanup exited with code ${code}: ${stderr}`));
    });
  });
}

async function removeDockerContainerAfterInterrupt(
  containerName: string,
  context: ExecutionContext,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await runDockerCleanupCommand(['rm', '-f', containerName], context);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Run Docker container with PTY (pseudo-terminal).
 * Used when terminal streaming is enabled for interactive output.
 * Returns captured stdout for backwards compatibility.
 */
async function runDockerWithPty<I, O>(
  dockerArgs: string[],
  params: I,
  context: ExecutionContext,
  timeoutSeconds: number,
  spawnEnv: NodeJS.ProcessEnv = process.env,
  containerName?: string,
): Promise<string> {
  throwIfCancelled(context);
  const spawnPty = await loadPtySpawn();
  if (!spawnPty) {
    context.logger.warn('[Docker][PTY] node-pty unavailable; falling back to standard IO');
    // Remove -t flag before falling back to standard IO (stdin is not a TTY)
    const argsWithoutTty = dockerArgs.filter((arg) => arg !== '-t');
    return runDockerWithStandardIO(
      argsWithoutTty,
      params,
      context,
      timeoutSeconds,
      undefined,
      false,
      spawnEnv,
      containerName,
    );
  }

  const dockerPath = await resolveDockerPath(context);
  return new Promise<string>((resolve, reject) => {
    const emitChunk = createTerminalChunkEmitter(context, 'pty');
    let stdout = '';

    let ptyProcess: ReturnType<typeof spawnPty>;
    try {
      // Debug: Log the full docker command
      context.logger.info(`[Docker][PTY] Spawning: ${dockerPath} ${formatArgs(dockerArgs)}`);

      ptyProcess = spawnPty(dockerPath, dockerArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        env: spawnEnv as Record<string, string>,
      });
    } catch (error) {
      const diag = {
        dockerPath,
        pathEnv: process.env.PATH,
        cwd: process.cwd(),
        error:
          error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
                name: error.name,
                // @ts-ignore
                code: error.code,
              }
            : String(error),
      };

      context.logger.warn(
        `[Docker][PTY] Failed to spawn PTY: ${error instanceof Error ? error.message : String(error)}. Diagnostic: ${JSON.stringify(diag)}`,
      );
      context.logger.warn('[Docker][PTY] Falling back to standard IO due to PTY spawn failure');

      // Remove -t flag and restore -i flag for standard IO (it was removed for PTY mode)
      const argsForStandardIO = dockerArgs.filter((arg) => arg !== '-t');
      if (!argsForStandardIO.includes('-i')) {
        argsForStandardIO.splice(2, 0, '-i');
      }
      resolve(
        runDockerWithStandardIO(
          argsForStandardIO,
          params,
          context,
          timeoutSeconds,
          undefined,
          false,
          spawnEnv,
          containerName,
        ),
      );
      return;
    }

    const timeout = setTimeout(() => {
      ptyProcess.kill();
      if (containerName) void removeDockerContainerAfterInterrupt(containerName, context);
      reject(
        new TimeoutError(
          `Docker container timed out after ${timeoutSeconds}s`,
          timeoutSeconds * 1000,
          {
            details: { dockerArgs: formatArgs(dockerArgs) },
          },
        ),
      );
    }, timeoutSeconds * 1000);
    const onAbort = () => {
      clearTimeout(timeout);
      ptyProcess.kill();
      const reason = cancellationReason(context.signal!);
      if (containerName) {
        void removeDockerContainerAfterInterrupt(containerName, context).finally(() =>
          reject(reason),
        );
      } else {
        reject(reason);
      }
    };
    context.signal?.addEventListener('abort', onAbort, { once: true });
    if (context.signal?.aborted) onAbort();

    // NEVER write JSON to stdin in PTY mode - it pollutes the terminal output
    // Components should use environment variables or command-line arguments instead

    ptyProcess.onData((data) => {
      emitChunk(data);
      stdout += data; // Capture for fallback
    });

    ptyProcess.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      context.signal?.removeEventListener('abort', onAbort);
      if (context.signal?.aborted) return;
      if (exitCode !== 0) {
        context.logger.error(`[Docker][PTY] Exited with code ${exitCode}`);

        // Emit error to UI
        context.emitProgress({
          message: `Docker container failed with exit code ${exitCode}`,
          level: 'error',
          data: { exitCode },
        });

        reject(
          new ContainerError(`Docker PTY execution failed with exit code ${exitCode}`, {
            details: {
              exitCode,
              stdout,
              dockerArgs: formatArgs(dockerArgs),
            },
          }),
        );
        return;
      }

      context.logger.info('[Docker][PTY] Completed successfully');
      context.emitProgress({
        message: 'Terminal stream completed',
        level: 'info',
        data: { stream: 'pty', origin: 'docker' },
      });
      context.emitProgress('Docker container completed');

      // Return captured stdout for fallback processing
      resolve(stdout);
    });
  });
}

export async function runComponentWithRunner<I, O>(
  runner: RunnerConfig,
  execute: (params: I, context: ExecutionContext) => Promise<O>,
  params: I,
  context: ExecutionContext,
): Promise<O> {
  switch (runner.kind) {
    case 'inline':
      return runComponentInline(execute, params, context);
    case 'docker':
      return runComponentInDocker<I, O>(runner, params, context);
    case 'remote':
      context.logger.info(`[Runner] remote execution stub for ${runner.endpoint}`);
      context.emitProgress('Remote execution not yet implemented; returning inline output');
      return runComponentInline(execute, params, context);
    default:
      throw new ConfigurationError(`Unsupported runner type: ${(runner as any).kind}`, {
        configKey: 'runner.kind',
        details: { runnerKind: (runner as any).kind },
      });
  }
}
