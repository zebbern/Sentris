const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const E2E_ENV_FILE = path.join('e2e-tests', '.env.e2e');
const DEV_APPS = ['backend', 'worker', 'frontend'];
const DEV_SCRIPT_ACTIONS = new Set(['start', 'stop', 'restart', 'logs', 'status', 'clean']);
const DEFAULT_PM2_LOG_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_DEV_HEALTH_TIMEOUT_MS = 1500;

function createDevScriptUsage() {
  return [
    'Usage: bun run dev [start|stop|restart|logs|status|clean]',
    '       bun run dev -- [start|stop|restart|logs|status|clean]',
  ].join('\n');
}

function normalizeScriptArgv(argv) {
  const args = [...(argv ?? [])];
  if (args[0] === '--') {
    args.shift();
  }
  return args;
}

function parseDevScriptArgs(argv = []) {
  const args = normalizeScriptArgv(argv);
  const positional = [];
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      positional.push('help');
      continue;
    }

    positional.push(arg);
  }

  const action = positional[0] ?? 'start';
  if (action === 'help') {
    if (positional.length > 1) {
      throw new Error(`Unexpected argument for dev help: ${positional[1]}`);
    }
    return { action, dryRun };
  }

  if (!DEV_SCRIPT_ACTIONS.has(action)) {
    throw new Error(`Unknown dev command: ${action}\n${createDevScriptUsage()}`);
  }

  if (positional.length > 1) {
    throw new Error(`Unexpected argument for dev ${action}: ${positional[1]}`);
  }

  return { action, dryRun };
}

function validateInstance(value, source) {
  const normalized = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${source} must be an integer from 0 to 9`);
  }

  const instance = Number.parseInt(normalized, 10);
  if (instance < 0 || instance > 9) {
    throw new Error(`${source} must be an integer from 0 to 9`);
  }

  return instance;
}

function readActiveInstanceFromFile(root = ROOT) {
  const filePath = path.join(root, '.sentris-instance');
  if (!fs.existsSync(filePath)) return undefined;
  const value = fs.readFileSync(filePath, 'utf8').trim();
  return value.length > 0 ? value : undefined;
}

function writeActiveInstanceFile(value, root = ROOT) {
  const instance = validateInstance(value, 'instance');
  fs.writeFileSync(path.join(root, '.sentris-instance'), `${instance}\n`);
  return instance;
}

function persistDefaultActiveInstance(options, value = 0) {
  if (options.persistDefault === false) return;
  if (typeof options.writeActiveInstanceFile === 'function') {
    options.writeActiveInstanceFile(String(value));
    return;
  }

  if (!options.readActiveInstanceFile) {
    writeActiveInstanceFile(String(value), options.root ?? ROOT);
  }
}

function resolveActiveDevInstance(options = {}) {
  const env = options.env ?? process.env;
  if (env.SENTRIS_INSTANCE?.trim()) {
    return validateInstance(env.SENTRIS_INSTANCE, 'SENTRIS_INSTANCE');
  }

  const fileValue =
    options.readActiveInstanceFile?.() ?? readActiveInstanceFromFile(options.root ?? ROOT);
  if (fileValue?.trim()) {
    return validateInstance(fileValue, '.sentris-instance');
  }

  persistDefaultActiveInstance(options, 0);
  return 0;
}

function resolveActiveE2eInstance(options = {}) {
  const env = options.env ?? process.env;
  if (env.SENTRIS_INSTANCE?.trim()) {
    return validateInstance(env.SENTRIS_INSTANCE, 'SENTRIS_INSTANCE');
  }

  if (env.E2E_INSTANCE?.trim()) {
    return validateInstance(env.E2E_INSTANCE, 'E2E_INSTANCE');
  }

  const fileValue =
    options.readActiveInstanceFile?.() ?? readActiveInstanceFromFile(options.root ?? ROOT);
  if (fileValue?.trim()) {
    return validateInstance(fileValue, '.sentris-instance');
  }

  persistDefaultActiveInstance(options, 0);
  return 0;
}

function createPm2AppNames(instance) {
  const normalized = validateInstance(instance, 'instance');
  return [
    `sentris-frontend-${normalized}`,
    `sentris-backend-${normalized}`,
    `sentris-worker-${normalized}`,
  ];
}

function resolvePm2LogMaxBytes(options = {}) {
  const env = options.env ?? process.env;
  const rawValue = options.maxBytes ?? env.SENTRIS_PM2_LOG_MAX_BYTES;

  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return DEFAULT_PM2_LOG_MAX_BYTES;
  }

  const maxBytes = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error('SENTRIS_PM2_LOG_MAX_BYTES must be a positive integer');
  }

  return maxBytes;
}

function resolvePm2Home(options = {}) {
  const env = options.env ?? process.env;
  return options.pm2Home ?? env.PM2_HOME ?? path.join(os.homedir(), '.pm2');
}

function createPm2DevLogPaths(instance, pm2Home) {
  const logDir = path.join(pm2Home, 'logs');
  const filePaths = createPm2AppNames(instance).flatMap((appName) => [
    path.join(logDir, `${appName}-out.log`),
    path.join(logDir, `${appName}-error.log`),
  ]);

  return { logDir, filePaths };
}

function prunePm2DevLogs(options = {}) {
  const instance = validateInstance(options.instance ?? 0, 'instance');
  const maxBytes = resolvePm2LogMaxBytes(options);
  const pm2Home = resolvePm2Home(options);
  const { logDir, filePaths } = createPm2DevLogPaths(instance, pm2Home);
  const files = [];

  if (!fs.existsSync(logDir)) {
    return { logDir, maxBytes, files };
  }

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const beforeBytes = fs.statSync(filePath).size;
    let afterBytes = beforeBytes;
    let pruned = false;

    if (beforeBytes > maxBytes) {
      fs.truncateSync(filePath, 0);
      afterBytes = fs.statSync(filePath).size;
      pruned = true;
    }

    files.push({ filePath, beforeBytes, afterBytes, pruned });
  }

  return { logDir, maxBytes, files };
}

function shouldStopSharedInfra(instance) {
  return validateInstance(instance, 'instance') === 0;
}

function getInstanceEnvDir(root, instance) {
  return path.join(root, '.instances', `instance-${instance}`);
}

function getInstanceDatabaseUrl(instance) {
  return `postgresql://sentris:sentris@localhost:5433/sentris_instance_${instance}`;
}

function getInstanceBackendPort(instance) {
  return 3211 + validateInstance(instance, 'instance') * 100;
}

function getInstanceFrontendPort(instance) {
  return 5173 + validateInstance(instance, 'instance') * 100;
}

function getInstanceWorkerHealthPort(instance) {
  return 9100 + validateInstance(instance, 'instance') * 100;
}

function getInstanceTemporalName(instance) {
  return `sentris-dev-${validateInstance(instance, 'instance')}`;
}

function createDevHealthProbeTargets(instance) {
  const normalized = validateInstance(instance, 'instance');
  const backendPort = getInstanceBackendPort(normalized);
  const frontendPort = getInstanceFrontendPort(normalized);
  const workerHealthPort = getInstanceWorkerHealthPort(normalized);

  return [
    {
      id: 'frontend',
      label: 'Frontend',
      url: `http://127.0.0.1:${frontendPort}`,
    },
    {
      id: 'backend-liveness',
      label: 'Backend liveness',
      url: `http://127.0.0.1:${backendPort}/health`,
    },
    {
      id: 'backend-readiness',
      label: 'Backend readiness',
      url: `http://127.0.0.1:${backendPort}/health/ready`,
    },
    {
      id: 'worker-health',
      label: 'Worker health',
      url: `http://127.0.0.1:${workerHealthPort}/health`,
    },
  ];
}

function getErrorSignal(error) {
  if (error && typeof error === 'object') {
    const code = error.code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }

  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error);
}

async function defaultDevHealthProbeRequest(url, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_HEALTH_TIMEOUT_MS;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  return {
    statusCode: response.status,
    statusText: response.statusText,
  };
}

async function probeDevHealthTarget(target, options = {}) {
  const request = options.request ?? defaultDevHealthProbeRequest;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEV_HEALTH_TIMEOUT_MS;

  try {
    const response = await request(target.url, { timeoutMs });
    const ok = response.statusCode >= 200 && response.statusCode < 300;
    return {
      ...target,
      ok,
      statusCode: response.statusCode,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ...target,
      ok: false,
      error: getErrorSignal(error),
    };
  }
}

function formatHttpStatus(statusCode, statusText) {
  const suffix = statusText ? ` ${statusText}` : '';
  return `HTTP ${statusCode}${suffix}`;
}

function formatDevHealthProbeResult(result) {
  if (result.ok) {
    return `✓ ${result.label}: OK (${formatHttpStatus(result.statusCode, result.statusText)}) ${result.url}`;
  }

  if (typeof result.statusCode === 'number') {
    return `⚠ ${result.label}: NOT READY (${formatHttpStatus(result.statusCode, result.statusText)}) ${result.url}`;
  }

  return `✗ ${result.label}: UNREACHABLE (${result.error ?? 'unknown error'}) ${result.url}`;
}

function getInstanceEnvSource(root, app) {
  const appEnv = path.join(root, app, '.env');
  if (fs.existsSync(appEnv)) return appEnv;

  const appExample = path.join(root, app, '.env.example');
  if (fs.existsSync(appExample)) return appExample;

  return undefined;
}

function setEnvFileValue(content, key, value) {
  const lines = String(content ?? '').split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }

  const nextLines = [];
  let replaced = false;
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      if (!replaced) {
        nextLines.push(`${key}=${value}`);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) {
    if (nextLines.length > 0 && nextLines.at(-1) !== '') {
      nextLines.push('');
    }
    nextLines.push(`${key}=${value}`);
  }

  return `${nextLines.join('\n')}\n`;
}

function applyInstanceEnvValues(content, app, instance) {
  let next = content;
  const temporalName = getInstanceTemporalName(instance);

  next = setEnvFileValue(next, 'DATABASE_URL', getInstanceDatabaseUrl(instance));
  next = setEnvFileValue(next, 'TEMPORAL_NAMESPACE', temporalName);
  next = setEnvFileValue(next, 'TEMPORAL_TASK_QUEUE', temporalName);

  if (app === 'backend') {
    next = setEnvFileValue(next, 'PORT', String(getInstanceBackendPort(instance)));
  } else if (app === 'worker') {
    next = setEnvFileValue(
      next,
      'SENTRIS_API_BASE_URL',
      `http://localhost:${getInstanceBackendPort(instance)}/api/v1`,
    );
  } else if (app === 'frontend') {
    next = setEnvFileValue(next, 'VITE_API_URL', `http://localhost:${getInstanceBackendPort(instance)}`);
  } else {
    throw new Error(`Unknown app: ${app}`);
  }

  return next;
}

function ensureInstanceEnvFiles(options = {}) {
  const root = options.root ?? ROOT;
  const instance = validateInstance(options.instance ?? 0, 'instance');
  const dir = getInstanceEnvDir(root, instance);

  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  for (const app of DEV_APPS) {
    const filePath = path.join(dir, `${app}.env`);
    const created = !fs.existsSync(filePath);
    const sourcePath = created ? getInstanceEnvSource(root, app) : undefined;

    if (created && !sourcePath) {
      throw new Error(`Missing source env file for ${app}: expected ${app}/.env or ${app}/.env.example`);
    }

    const baseContent = created
      ? fs.readFileSync(sourcePath, 'utf8')
      : fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, applyInstanceEnvValues(baseContent, app, instance));
    files.push({ app, filePath, created });
  }

  return { instance, dir, files };
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/');
}

function resolvePm2Command(options = {}) {
  const root = options.root ?? ROOT;
  const fileExists = options.fileExists ?? fs.existsSync;
  const nodePath = options.nodePath ?? process.execPath;
  const localPm2Bin = toPortablePath(path.join(root, 'node_modules', 'pm2', 'bin', 'pm2'));

  if (fileExists(localPm2Bin)) {
    return {
      command: nodePath,
      argsPrefix: [localPm2Bin],
      displayName: 'local PM2',
    };
  }

  return {
    command: 'pm2',
    argsPrefix: [],
    displayName: 'global PM2',
  };
}

function unquoteEnvValue(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseE2eEnvFile(content) {
  const values = {};

  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    values[key] = unquoteEnvValue(normalized.slice(separatorIndex + 1));
  }

  return values;
}

function readE2eEnvFile(options = {}) {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? fs.existsSync;
  const readFile = options.readFile ?? ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const filePath = env.SENTRIS_E2E_ENV_FILE?.trim()
    ? env.SENTRIS_E2E_ENV_FILE.trim()
    : path.join(options.root ?? ROOT, E2E_ENV_FILE);

  if (!fileExists(filePath)) {
    return null;
  }

  return {
    filePath,
    values: parseE2eEnvFile(readFile(filePath)),
  };
}

function createE2eTestCommand(options = {}) {
  const instance = validateInstance(options.instance ?? 0, 'instance');
  const targets = Array.isArray(options.targets) && options.targets.length > 0
    ? options.targets
    : ['e2e-tests'];
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];
  const env = {
    SENTRIS_INSTANCE: String(instance),
    RUN_E2E: 'true',
  };

  if (options.cloud) {
    env.RUN_CLOUD_E2E = 'true';
  }

  return {
    command: 'bun',
    args: ['test', '--force-exit', ...targets, ...extraArgs],
    env,
  };
}

function createRootTestPlan(options = {}) {
  validateInstance(options.instance ?? 0, 'instance');

  return {
    cleanupPaths: ['worker/dist'],
    commands: [
      { command: 'bun', args: ['test', 'packages'] },
      { command: 'bun', args: ['test', 'backend'] },
      { command: 'bun', args: ['test', 'worker'] },
      { command: 'bun', args: ['test', 'e2e-tests'] },
      { command: 'bun', args: ['run', 'test'], cwd: 'frontend' },
    ],
  };
}

function createTemplateLibraryVerifyPlan() {
  return {
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
  };
}

function createSecurityComponentsVerifyPlan() {
  return {
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
  };
}

module.exports = {
  createE2eTestCommand,
  createRootTestPlan,
  createTemplateLibraryVerifyPlan,
  createSecurityComponentsVerifyPlan,
  parseE2eEnvFile,
  prunePm2DevLogs,
  readE2eEnvFile,
  createDevScriptUsage,
  createDevHealthProbeTargets,
  createPm2AppNames,
  ensureInstanceEnvFiles,
  formatDevHealthProbeResult,
  parseDevScriptArgs,
  probeDevHealthTarget,
  resolvePm2Command,
  writeActiveInstanceFile,
  resolveActiveDevInstance,
  resolveActiveE2eInstance,
  shouldStopSharedInfra,
};
