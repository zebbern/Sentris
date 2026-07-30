#!/usr/bin/env bun

import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  buildPerformanceArtifact,
  buildReleaseBenchmarkConfig,
  buildReleaseBenchmarkWorkflows,
  durationBetweenTraceEvents,
  type ReleaseBenchmarkConfig,
} from './lib/release-benchmark';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT']);

interface RunStatus {
  status?: string;
  startedAt?: string;
  completedAt?: string;
}

interface TraceEvent {
  nodeId?: string;
  type?: string;
  timestamp?: string;
}

interface RawBenchmarkSamples {
  apiRequestMs: number[];
  workflowDurationMs: number[];
  componentStartupMs: number[];
  frontendJourneyMs: number[];
  workflowThroughputPerMinute: number;
}

class ReleaseBenchmarkApi {
  private readonly headers: Record<string, string>;

  constructor(private readonly config: ReleaseBenchmarkConfig) {
    this.headers = {
      'Content-Type': 'application/json',
      'x-internal-token': config.internalToken,
    };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(this.config.runTimeoutMs),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${init.method ?? 'GET'} ${path} failed: HTTP ${response.status} ${body}`);
    }
    return (await response.json()) as T;
  }

  async timeRequest(path: string): Promise<number> {
    const startedAt = performance.now();
    await this.request(path);
    return performance.now() - startedAt;
  }

  async createWorkflow(workflow: unknown): Promise<string> {
    const created = await this.request<{ id?: string }>('/workflows', {
      method: 'POST',
      body: JSON.stringify(workflow),
    });
    if (!created.id) {
      throw new Error('Workflow creation response did not include an id');
    }
    return created.id;
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.request(`/workflows/${encodeURIComponent(workflowId)}`, { method: 'DELETE' });
  }

  async startRun(workflowId: string): Promise<string> {
    const started = await this.request<{ runId?: string }>(
      `/workflows/${encodeURIComponent(workflowId)}/run`,
      {
        method: 'POST',
        body: JSON.stringify({ inputs: {} }),
      },
    );
    if (!started.runId) {
      throw new Error('Workflow run response did not include a runId');
    }
    return started.runId;
  }

  async waitForCompletedRun(runId: string): Promise<RunStatus> {
    const deadline = Date.now() + this.config.runTimeoutMs;
    let last: RunStatus | undefined;
    while (Date.now() < deadline) {
      last = await this.request<RunStatus>(`/workflows/runs/${encodeURIComponent(runId)}/status`);
      if (TERMINAL_STATUSES.has(last.status ?? '')) {
        if (last.status !== 'COMPLETED') {
          throw new Error(`Benchmark run ${runId} finished with status ${last.status}`);
        }
        return last;
      }
      await delay(this.config.pollIntervalMs);
    }
    throw new Error(
      `Benchmark run ${runId} did not complete within ${this.config.runTimeoutMs}ms; last=${JSON.stringify(last)}`,
    );
  }

  async waitForNodeTrace(runId: string, nodeId: string): Promise<TraceEvent[]> {
    const deadline = Date.now() + Math.min(this.config.runTimeoutMs, 30_000);
    let lastEvents: TraceEvent[] = [];
    while (Date.now() < deadline) {
      const trace = await this.request<{ events?: TraceEvent[] }>(
        `/workflows/runs/${encodeURIComponent(runId)}/trace`,
      );
      lastEvents = trace.events ?? [];
      if (
        lastEvents.some((event) => event.nodeId === nodeId && event.type === 'STARTED') &&
        lastEvents.some((event) => event.nodeId === nodeId && event.type === 'COMPLETED')
      ) {
        return lastEvents;
      }
      await delay(this.config.pollIntervalMs);
    }
    throw new Error(
      `Persisted trace for run ${runId} did not include ${nodeId} completion: ${JSON.stringify(lastEvents)}`,
    );
  }

  async createScope(name: string): Promise<string> {
    const created = await this.request<{ id?: string }>('/scopes', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: 'Disposable frontend release benchmark target',
        domains: ['example.com'],
        repos: [],
        ipRanges: [],
        runtimeValues: {},
      }),
    });
    if (!created.id) {
      throw new Error('Scope creation response did not include an id');
    }
    return created.id;
  }

  async deleteScope(scopeId: string): Promise<void> {
    await this.request(`/scopes/${encodeURIComponent(scopeId)}`, { method: 'DELETE' });
  }
}

class CdpSession {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? 'Chrome DevTools command failed'));
      } else {
        waiter.resolve(message.result);
      }
    });
  }

  static async connect(webSocketUrl: string): Promise<CdpSession> {
    const socket = new WebSocket(webSocketUrl);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(
        () => rejectOpen(new Error('Timed out connecting to Chrome DevTools')),
        10_000,
      );
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolveOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          rejectOpen(new Error('Failed to connect to Chrome DevTools'));
        },
        { once: true },
      );
    });
    return new CdpSession(socket);
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = this.nextId++;
    const result = new Promise<T>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`Chrome DevTools command ${method} timed out`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => resolveCommand(value as T),
        reject: rejectCommand,
        timer,
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Chrome DevTools session closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

interface ChromeHandle {
  session: CdpSession;
  close(): Promise<void>;
}

async function launchChrome(config: ReleaseBenchmarkConfig): Promise<ChromeHandle> {
  const executable = resolveChromeExecutable(process.env);
  const debugPort = await reserveEphemeralPort();
  const profileDir = mkdtempSync(join(tmpdir(), 'sentris-release-benchmark-'));
  const args = [
    executable,
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.splice(1, 0, '--no-sandbox');
  }

  const child = Bun.spawn(args, {
    stdout: 'ignore',
    stderr: 'pipe',
  });

  try {
    const page = await waitForChromePage(debugPort, config.runTimeoutMs);
    const session = await CdpSession.connect(page.webSocketDebuggerUrl);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    return {
      session,
      async close() {
        session.close();
        child.kill();
        await child.exited.catch(() => undefined);
        removeOwnedChromeProfile(profileDir);
      },
    };
  } catch (error) {
    child.kill();
    await child.exited.catch(() => undefined);
    removeOwnedChromeProfile(profileDir);
    throw error;
  }
}

function resolveChromeExecutable(env: Record<string, string | undefined>): string {
  const configured = env.CHROME_PATH?.trim() || env.GOOGLE_CHROME_SHIM?.trim();
  const candidates = [
    configured,
    process.platform === 'win32'
      ? join(
          env.ProgramFiles ?? 'C:\\Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        )
      : undefined,
    process.platform === 'win32'
      ? join(
          env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        )
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find(existsSync);
  if (!executable) {
    throw new Error('Chrome was not found; set CHROME_PATH to a Chrome or Chromium executable');
  }
  return executable;
}

async function reserveEphemeralPort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Could not reserve a Chrome debugging port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(port);
      });
    });
  });
}

async function waitForChromePage(
  debugPort: number,
  timeoutMs: number,
): Promise<{ webSocketDebuggerUrl: string }> {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      const targets = (await response.json()) as Array<{
        type?: string;
        webSocketDebuggerUrl?: string;
      }>;
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        return { webSocketDebuggerUrl: page.webSocketDebuggerUrl };
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${String(lastError ?? 'no page target')}`);
}

function removeOwnedChromeProfile(profileDir: string): void {
  const resolvedProfile = realpathSync.native(profileDir);
  const resolvedTemp = realpathSync.native(tmpdir());
  const expectedPrefix = `${resolvedTemp}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!resolvedProfile.startsWith(expectedPrefix)) {
    throw new Error(
      `Refusing to remove Chrome profile outside the temporary directory: ${profileDir}`,
    );
  }
  rmSync(resolvedProfile, { recursive: true, force: true });
}

async function navigateAndWait(
  session: CdpSession,
  url: string,
  conditionExpression: string,
  timeoutMs: number,
): Promise<void> {
  await session.send('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const evaluation = await session.send<{
      result?: { value?: unknown };
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Boolean(${conditionExpression})`,
      returnByValue: true,
    });
    if (!evaluation.exceptionDetails && evaluation.result?.value === true) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Frontend did not reach the expected state at ${url}`);
}

async function authenticateLocalFrontend(
  session: CdpSession,
  config: ReleaseBenchmarkConfig,
): Promise<void> {
  await navigateAndWait(session, config.frontendUrl, 'document.body', config.runTimeoutMs);
  const username = JSON.stringify(config.adminUsername);
  const password = JSON.stringify(config.adminPassword);
  const evaluation = await session.send<{
    result?: { value?: { ok?: boolean; status?: number } };
    exceptionDetails?: unknown;
  }>('Runtime.evaluate', {
    expression: `(async () => {
      const credentials = btoa(${username} + ':' + ${password});
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + credentials, 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      return { ok: response.ok, status: response.status };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails || !evaluation.result?.value?.ok) {
    throw new Error(
      `Frontend local authentication failed with HTTP ${evaluation.result?.value?.status ?? 'unknown'}`,
    );
  }
}

async function measureFrontendJourneys(
  config: ReleaseBenchmarkConfig,
  scopeId: string,
  scopeName: string,
): Promise<number[]> {
  if (config.trustProfile !== 'trusted-local') {
    throw new Error(
      'Automated frontend release benchmarks currently require the trusted-local local-auth profile',
    );
  }
  const chrome = await launchChrome(config);
  try {
    await authenticateLocalFrontend(chrome.session, config);
    const encodedName = JSON.stringify(scopeName);
    const targetsUrl = `${config.frontendUrl}/targets`;
    const targetUrl = `${config.frontendUrl}/targets/${encodeURIComponent(scopeId)}`;
    const findingsUrl = `${config.frontendUrl}/findings?scopeId=${encodeURIComponent(scopeId)}`;

    await navigateAndWait(
      chrome.session,
      targetsUrl,
      `document.body.innerText.includes(${encodedName})`,
      config.runTimeoutMs,
    );

    const samples: number[] = [];
    for (let index = 0; index < config.sampleCount; index += 1) {
      const startedAt = performance.now();
      await navigateAndWait(
        chrome.session,
        targetsUrl,
        `document.body.innerText.includes(${encodedName})`,
        config.runTimeoutMs,
      );
      await navigateAndWait(
        chrome.session,
        targetUrl,
        `document.body.innerText.includes(${encodedName})`,
        config.runTimeoutMs,
      );
      await navigateAndWait(
        chrome.session,
        findingsUrl,
        `document.body.innerText.includes('Findings') && !document.querySelector('[aria-busy="true"]')`,
        config.runTimeoutMs,
      );
      samples.push(performance.now() - startedAt);
    }
    return samples;
  } finally {
    await chrome.close();
  }
}

function runDurationMs(status: RunStatus, runId: string): number {
  const start = Date.parse(status.startedAt ?? '');
  const end = Date.parse(status.completedAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error(
      `Benchmark run ${runId} did not expose a positive startedAt/completedAt duration`,
    );
  }
  return end - start;
}

async function measureApiRequests(
  api: ReleaseBenchmarkApi,
  sampleCount: number,
): Promise<number[]> {
  const paths = ['/workflows/summary', '/components', '/workflows'];
  for (const path of paths) {
    await api.request(path);
  }
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await api.timeRequest(paths[index % paths.length]!));
  }
  return samples;
}

async function measureWorkflowRuns(
  api: ReleaseBenchmarkApi,
  workflowId: string,
  sampleCount: number,
): Promise<{ durationsMs: number[]; throughputPerMinute: number }> {
  const warmupRun = await api.startRun(workflowId);
  await api.waitForCompletedRun(warmupRun);

  const startedAt = performance.now();
  const runIds = await Promise.all(
    Array.from({ length: sampleCount }, () => api.startRun(workflowId)),
  );
  const statuses = await Promise.all(runIds.map((runId) => api.waitForCompletedRun(runId)));
  const elapsedMs = performance.now() - startedAt;
  return {
    durationsMs: statuses.map((status, index) => runDurationMs(status, runIds[index]!)),
    throughputPerMinute: sampleCount / (elapsedMs / 60_000),
  };
}

async function measureDockerComponent(
  api: ReleaseBenchmarkApi,
  workflowId: string,
  sampleCount: number,
): Promise<number[]> {
  const runOnce = async (): Promise<number> => {
    const runId = await api.startRun(workflowId);
    await api.waitForCompletedRun(runId);
    const events = await api.waitForNodeTrace(runId, 'docker');
    return durationBetweenTraceEvents(events, 'docker');
  };

  await runOnce();
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(await runOnce());
  }
  return samples;
}

async function collectBenchmark(
  config: ReleaseBenchmarkConfig,
): Promise<{ artifact: Record<string, unknown>; rawSamples: RawBenchmarkSamples }> {
  const api = new ReleaseBenchmarkApi(config);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const workflows = buildReleaseBenchmarkWorkflows(suffix);
  const cleanupWorkflowIds: string[] = [];
  let scopeId: string | undefined;

  try {
    console.log(`Benchmarking instance ${config.instance} at ${config.apiBaseUrl}`);
    const inlineWorkflowId = await api.createWorkflow(workflows.inline);
    cleanupWorkflowIds.push(inlineWorkflowId);
    const dockerWorkflowId = await api.createWorkflow(workflows.docker);
    cleanupWorkflowIds.push(dockerWorkflowId);
    const scopeName = `release-benchmark-target-${suffix}`;
    scopeId = await api.createScope(scopeName);

    const apiRequestMs = await measureApiRequests(api, config.sampleCount);
    const workflow = await measureWorkflowRuns(api, inlineWorkflowId, config.sampleCount);
    const componentStartupMs = await measureDockerComponent(
      api,
      dockerWorkflowId,
      config.sampleCount,
    );
    const frontendJourneyMs = await measureFrontendJourneys(config, scopeId, scopeName);

    const rawSamples: RawBenchmarkSamples = {
      apiRequestMs,
      workflowDurationMs: workflow.durationsMs,
      componentStartupMs,
      frontendJourneyMs,
      workflowThroughputPerMinute: workflow.throughputPerMinute,
    };
    const baseArtifact = buildPerformanceArtifact({
      instance: config.instance,
      trustProfile: config.trustProfile,
      hostFingerprint: config.hostFingerprint,
      revision: config.revision,
      recordedAt: new Date().toISOString(),
      apiRequestSamplesMs: rawSamples.apiRequestMs,
      workflowDurationSamplesMs: rawSamples.workflowDurationMs,
      workflowThroughputPerMinute: rawSamples.workflowThroughputPerMinute,
      workflowSampleCount: config.sampleCount,
      componentStartupSamplesMs: rawSamples.componentStartupMs,
      frontendJourneySamplesMs: rawSamples.frontendJourneyMs,
      description:
        config.description ??
        `Sentris release benchmark (${config.sampleCount} samples, warm Docker image)`,
    });
    return {
      artifact: {
        ...baseArtifact,
        methodology: {
          apiPaths: ['/workflows/summary', '/components', '/workflows'],
          workflow: 'test.sleep.parallel (50ms), concurrent sample batch after one warm-up',
          component:
            'test.docker.echo, persisted STARTED-to-COMPLETED duration after one image warm-up',
          frontend:
            'headless Chrome full navigation: targets list -> target detail -> scope-filtered findings',
          pollIntervalMs: config.pollIntervalMs,
        },
        rawSamples,
      },
      rawSamples,
    };
  } finally {
    if (scopeId) {
      await api
        .deleteScope(scopeId)
        .catch((error) => console.warn(`Failed to delete benchmark scope ${scopeId}: ${error}`));
    }
    for (const workflowId of cleanupWorkflowIds.reverse()) {
      await api
        .deleteWorkflow(workflowId)
        .catch((error) =>
          console.warn(`Failed to delete benchmark workflow ${workflowId}: ${error}`),
        );
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function printDryRun(config: ReleaseBenchmarkConfig): void {
  console.log(
    JSON.stringify(
      {
        instance: config.instance,
        apiBaseUrl: config.apiBaseUrl,
        frontendUrl: config.frontendUrl,
        trustProfile: config.trustProfile,
        hostFingerprint: config.hostFingerprint,
        sampleCount: config.sampleCount,
        revision: config.revision,
        outputPath: config.outputPath,
        runTimeoutMs: config.runTimeoutMs,
        pollIntervalMs: config.pollIntervalMs,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<number> {
  try {
    const args = process.argv.slice(2);
    const unknown = args.filter((arg) => arg !== '--dry-run');
    if (unknown.length > 0) {
      throw new Error(`Unknown release benchmark option: ${unknown[0]}`);
    }
    const config = buildReleaseBenchmarkConfig(process.env);
    if (args.includes('--dry-run')) {
      printDryRun(config);
      return 0;
    }

    const { artifact } = await collectBenchmark(config);
    const outputPath = resolve(config.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8' });
    console.log(`Release benchmark artifact written to ${outputPath}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exit(await main());
