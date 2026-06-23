// NOTE: pm2 is AGPL-3.0 licensed. It is used ONLY for local development
// orchestration (devDependencies). It must NEVER be included in production
// Docker images or distributed artifacts.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Resolve the real bun binary path. On Windows, PM2 resolves 'bun' to
 * bun.cmd (a batch-file shim) which it cannot execute. This helper
 * locates the actual bun.exe so PM2 can run it directly.
 */
function resolveBun() {
  if (process.platform !== 'win32') return 'bun';
  try {
    const result = execSync('where.exe bun.exe', { encoding: 'utf8', timeout: 5000 });
    const paths = result.trim().split(/\r?\n/);
    const realBun = paths.find(p => !p.toLowerCase().endsWith('.cmd'));
    if (realBun) return realBun.trim();
  } catch (_) {
    // where.exe failed — try known fallback locations.
  }
  const fallback = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe');
  try {
    fs.accessSync(fallback);
    return fallback;
  } catch (_) {
    // Fallback path does not exist.
  }
  return 'bun';
}

const BUN = resolveBun();

function isLinuxMusl() {
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
    if (report?.header?.glibcVersionRuntime) {
      return false;
    }
    if (Array.isArray(report?.sharedObjects)) {
      if (report.sharedObjects.some((file) => file.includes('libc.musl-') || file.includes('ld-musl-'))) {
        return true;
      }
    }
  } catch (_) {
    // Ignore report inspection errors and continue with filesystem probing.
  }

  try {
    const ldd = fs.readFileSync('/usr/bin/ldd', 'utf-8');
    if (ldd.includes('musl')) {
      return true;
    }
  } catch (_) {
    // Ignore missing ldd; we'll try the child process fallback.
  }

  try {
    const output = require('child_process')
      .execSync('ldd --version', { encoding: 'utf8' })
      .toLowerCase();
    return output.includes('musl');
  } catch (_) {
    return false;
  }
}

function getSwcTargets() {
  const { platform, arch } = process;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return ['darwin-arm64'];
    }
    if (arch === 'x64') {
      return ['darwin-x64'];
    }
  }

  if (platform === 'linux') {
    const musl = isLinuxMusl();
    if (arch === 'x64') {
      return musl ? ['linux-x64-musl', 'linux-x64-gnu'] : ['linux-x64-gnu', 'linux-x64-musl'];
    }
    if (arch === 'arm64') {
      return musl ? ['linux-arm64-musl', 'linux-arm64-gnu'] : ['linux-arm64-gnu', 'linux-arm64-musl'];
    }
    if (arch === 'arm') {
      return ['linux-arm-gnueabihf'];
    }
    if (arch === 'riscv64') {
      return musl ? ['linux-riscv64-musl', 'linux-riscv64-gnu'] : ['linux-riscv64-gnu', 'linux-riscv64-musl'];
    }
    if (arch === 's390x') {
      return ['linux-s390x-gnu'];
    }
  }

  if (platform === 'win32') {
    if (arch === 'x64') {
      return ['win32-x64-msvc'];
    }
    if (arch === 'ia32') {
      return ['win32-ia32-msvc'];
    }
    if (arch === 'arm64') {
      return ['win32-arm64-msvc'];
    }
  }

  if (platform === 'freebsd') {
    if (arch === 'x64') {
      return ['freebsd-x64'];
    }
    if (arch === 'arm64') {
      return ['freebsd-arm64'];
    }
  }

  if (platform === 'android') {
    if (arch === 'arm64') {
      return ['android-arm64'];
    }
    if (arch === 'arm') {
      return ['android-arm-eabi'];
    }
  }

  return [];
}

function collectCandidatePaths(target) {
  const candidates = [];
  const bunDir = path.join(__dirname, 'node_modules', '.bun');
  const aggregateDir = path.join(bunDir, 'node_modules', '@swc', `core-${target}`, `swc.${target}.node`);

  if (aggregateDir && fs.existsSync(aggregateDir)) {
    candidates.push(aggregateDir);
  }

  try {
    const entries = fs.readdirSync(bunDir);
    for (const entry of entries) {
      if (entry.startsWith(`@swc+core-${target}@`)) {
        const versionedPath = path.join(
          bunDir,
          entry,
          'node_modules',
          '@swc',
          `core-${target}`,
          `swc.${target}.node`,
        );
        candidates.push(versionedPath);
      }
    }
  } catch (_) {
    // Unable to scan versioned directories; continue with resolver fallback.
  }

  try {
    const resolvedPkg = require.resolve(`@swc/core-${target}/package.json`, {
      paths: [path.join(bunDir, 'node_modules'), __dirname],
    });
    const resolvedCandidate = path.join(path.dirname(resolvedPkg), `swc.${target}.node`);
    candidates.push(resolvedCandidate);
  } catch (_) {
    // Optional dependency may not be installed for this platform.
  }

  return Array.from(new Set(candidates));
}

function resolveSwcBinaryPath() {
  const targets = getSwcTargets();
  for (const target of targets) {
    const candidates = collectCandidatePaths(target);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

const swcBinaryPath = resolveSwcBinaryPath();
if (!swcBinaryPath) {
  console.warn('Unable to automatically resolve SWC native binary; Temporal workers will use default resolution.');
}

// Resolve the tsx binary path cross-platform. Bun installs `.exe` on Windows
// instead of the extensionless scripts that npm/yarn create.
function resolveTsxBinary() {
  const basePath = path.join(__dirname, 'node_modules', '.bin', 'tsx');
  const candidates = process.platform === 'win32'
    ? [basePath + '.exe', basePath + '.cmd', basePath]
    : [basePath];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // Fall back to the base path and let PM2 report the error.
  return basePath;
}

const tsxBinary = resolveTsxBinary();

// Load .env file and extract VITE_* variables for frontend
function loadFrontendEnv(envFilePath) {
  const env = { NODE_ENV: 'development' };

  try {
    if (fs.existsSync(envFilePath)) {
      const envContent = fs.readFileSync(envFilePath, 'utf-8');
      envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
          return;
        }
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          // Only include VITE_* variables for frontend
          if (key.startsWith('VITE_')) {
            env[key] = value;
          }
        }
      });
    }
  } catch (err) {
    console.warn('Failed to load frontend .env file:', err.message);
  }

  return env;
}

// Load worker .env file for OpenSearch and other worker-specific variables
function loadWorkerEnv() {
  const envPath = path.join(__dirname, 'worker', '.env');
  const env = {};

  try {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach((line) => {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
          return;
        }
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          env[key] = value;
        }
      });
    }
  } catch (err) {
    console.warn('Failed to load worker .env file:', err.message);
  }

  return env;
}

const workerEnv = loadWorkerEnv();

// Determine environment from NODE_ENV or SENTRIS_ENV
const environment = process.env.SENTRIS_ENV || process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Get instance number (0-9) for multi-instance support
const instanceNum = process.env.SENTRIS_INSTANCE || '0';
const instanceDatabaseUrl = `postgresql://sentris:sentris@localhost:5433/sentris_instance_${instanceNum}`;
// Only set these defaults for local development. In production, credentials must
// come from the environment / deployment config.
const devInstanceEnv = isProduction
  ? {}
  : {
      DATABASE_URL: instanceDatabaseUrl,
      SECRET_STORE_MASTER_KEY: process.env.SECRET_STORE_MASTER_KEY || 'SentrisLocalDevKey32Bytes!!!!!!!',
    };

// Environment-specific configuration
const envConfig = {
  development: {
    TEMPORAL_TASK_QUEUE: 'sentris-dev',
    TEMPORAL_NAMESPACE: 'sentris-dev',
    NODE_ENV: 'development',
  },
  production: {
    TEMPORAL_TASK_QUEUE: 'sentris-prod',
    TEMPORAL_NAMESPACE: 'sentris-prod',
    NODE_ENV: 'production',
  },
};

const currentEnvConfig = envConfig[isProduction ? 'production' : 'development'];
const sharedPackageSrc = path.join(__dirname, 'packages', 'shared', 'src');
const componentSdkPackageSrc = path.join(__dirname, 'packages', 'component-sdk', 'src');
const localRuntimePackageSrc = path.join(__dirname, 'packages', 'local-runtime', 'src');
const backendDevWatchPaths = ['src', 'scripts/seed-templates', sharedPackageSrc];
const workerDevWatchPaths = [
  'src',
  sharedPackageSrc,
  componentSdkPackageSrc,
  localRuntimePackageSrc,
].filter((watchPath) => fs.existsSync(watchPath) || watchPath === 'src');
const devRuntimeIgnoreWatch = [
  'node_modules',
  'dist',
  '*.log',
  '__tests__',
  '*.test.ts',
  '*.test.tsx',
  '*.spec.ts',
  '*.spec.tsx',
];

// Helper to get instance-specific env file path
function getInstanceEnvFile(appName, instance) {
  return __dirname + `/.instances/instance-${instance}/${appName}.env`;
}

// Helper to get instance-specific ports
function getInstancePort(basePort, instance) {
  return basePort + parseInt(instance) * 100;
}

// Get env file (use instance-specific if it exists, otherwise fall back to root)
function resolveEnvFile(appName, instance) {
  const instancePath = getInstanceEnvFile(appName, instance);
  const rootPath = __dirname + `/${appName}/.env`;
  
  if (fs.existsSync(instancePath)) {
    return instancePath;
  }
  return rootPath;
}

module.exports = {
  apps: [
    {
      name: `sentris-backend-${instanceNum}`,
      cwd: __dirname + '/backend',
      script: BUN,
      args: isProduction ? 'src/main.ts' : 'run dev',
      interpreter: 'none',
      env_file: resolveEnvFile('backend', instanceNum),
      env: {
        ...currentEnvConfig,
        SENTRIS_INSTANCE: instanceNum,
        PORT: getInstancePort(3211, instanceNum),
        // Ensure instance DB isolation even if dotenv auto-loads a workspace/default `.env`.
        ...devInstanceEnv,
        TERMINAL_REDIS_URL: process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379',
        LOG_KAFKA_BROKERS: process.env.LOG_KAFKA_BROKERS || 'localhost:9092',
        LOG_KAFKA_TOPIC: process.env.LOG_KAFKA_TOPIC || 'telemetry.logs',
        LOG_KAFKA_CLIENT_ID: process.env.LOG_KAFKA_CLIENT_ID || `sentris-backend-${instanceNum}`,
        LOG_KAFKA_GROUP_ID: process.env.LOG_KAFKA_GROUP_ID || `sentris-backend-log-consumer-${instanceNum}`,
        EVENT_KAFKA_TOPIC: process.env.EVENT_KAFKA_TOPIC || 'telemetry.events',
        EVENT_KAFKA_CLIENT_ID: process.env.EVENT_KAFKA_CLIENT_ID || `sentris-backend-events-${instanceNum}`,
        EVENT_KAFKA_GROUP_ID: process.env.EVENT_KAFKA_GROUP_ID || `sentris-event-ingestor-${instanceNum}`,
        NODE_IO_KAFKA_TOPIC: process.env.NODE_IO_KAFKA_TOPIC || 'telemetry.node-io',
        NODE_IO_KAFKA_CLIENT_ID:
          process.env.NODE_IO_KAFKA_CLIENT_ID || `sentris-backend-node-io-${instanceNum}`,
        NODE_IO_KAFKA_GROUP_ID:
          process.env.NODE_IO_KAFKA_GROUP_ID || `sentris-node-io-ingestor-${instanceNum}`,
        AGENT_TRACE_KAFKA_TOPIC: process.env.AGENT_TRACE_KAFKA_TOPIC || 'telemetry.agent-trace',
        AGENT_TRACE_KAFKA_CLIENT_ID:
          process.env.AGENT_TRACE_KAFKA_CLIENT_ID || `sentris-backend-agent-trace-${instanceNum}`,
        AGENT_TRACE_KAFKA_GROUP_ID:
          process.env.AGENT_TRACE_KAFKA_GROUP_ID || `sentris-agent-trace-ingestor-${instanceNum}`,
        ENABLE_INGEST_SERVICES: process.env.ENABLE_INGEST_SERVICES || 'true',
        INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
        TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
        TEMPORAL_NAMESPACE: `sentris-dev-${instanceNum}`,
        TEMPORAL_TASK_QUEUE: `sentris-dev-${instanceNum}`,
      },
      watch: !isProduction ? backendDevWatchPaths : false,
      ignore_watch: devRuntimeIgnoreWatch,
      max_memory_restart: '500M',
    },
    {
      name: `sentris-frontend-${instanceNum}`,
      cwd: __dirname + '/frontend',
      script: BUN,
      args: 'run dev',
      interpreter: 'none',
      env_file: resolveEnvFile('frontend', instanceNum),
      env: {
        ...loadFrontendEnv(resolveEnvFile('frontend', instanceNum)),
        ...currentEnvConfig,
        SENTRIS_INSTANCE: instanceNum,
      },
      watch: !isProduction ? ['src'] : false,
      ignore_watch: devRuntimeIgnoreWatch,
    },
    {
      name: `sentris-worker-${instanceNum}`,
      cwd: __dirname + '/worker',
      // Run the worker with Node + tsx to avoid Bun's SWC binding issues
      script: tsxBinary,
      args: 'src/temporal/workers/dev.worker.ts',
      env_file: resolveEnvFile('worker', instanceNum),
      env: Object.assign(
        {
          ...workerEnv, // Load worker .env file (includes OPENSEARCH_URL, etc.)
          ...currentEnvConfig,
          SENTRIS_INSTANCE: instanceNum,
          NAPI_RS_FORCE_WASI: '1',
          INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN || 'local-internal-token',
          SENTRIS_API_BASE_URL: process.env.SENTRIS_API_BASE_URL || `http://localhost:${getInstancePort(3211, instanceNum)}/api/v1`,
          ...devInstanceEnv,
          TERMINAL_REDIS_URL: process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379',
          LOG_KAFKA_BROKERS: process.env.LOG_KAFKA_BROKERS || 'localhost:9092',
          LOG_KAFKA_TOPIC: process.env.LOG_KAFKA_TOPIC || 'telemetry.logs',
          LOG_KAFKA_CLIENT_ID: process.env.LOG_KAFKA_CLIENT_ID || `sentris-worker-${instanceNum}`,
          EVENT_KAFKA_TOPIC: process.env.EVENT_KAFKA_TOPIC || 'telemetry.events',
          EVENT_KAFKA_CLIENT_ID: process.env.EVENT_KAFKA_CLIENT_ID || `sentris-worker-events-${instanceNum}`,
          TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
          TEMPORAL_NAMESPACE: `sentris-dev-${instanceNum}`,
          TEMPORAL_TASK_QUEUE: `sentris-dev-${instanceNum}`,
          SKIP_CONTAINER_CLEANUP: process.env.SKIP_CONTAINER_CLEANUP || 'false',
          WORKER_HEALTH_PORT: getInstancePort(9100, instanceNum),
        },
        swcBinaryPath ? { SWC_BINARY_PATH: swcBinaryPath } : {},
      ),
      watch: !isProduction ? workerDevWatchPaths : false,
      ignore_watch: devRuntimeIgnoreWatch,
      max_memory_restart: '1G',
    },
    {
      name: 'sentris-test-worker',
      cwd: __dirname + '/worker',
      // Use Node + tsx here as well
      script: tsxBinary,
      args: 'src/temporal/workers/dev.worker.ts',
      env_file: __dirname + '/worker/.env',
      env: Object.assign(
        {
          ...workerEnv, // Load worker .env file (includes OPENSEARCH_URL, etc.)
          TEMPORAL_TASK_QUEUE: 'test-worker-integration',
          TEMPORAL_NAMESPACE: 'sentris-dev',
          NODE_ENV: 'development',
          NAPI_RS_FORCE_WASI: '1',
        },
        swcBinaryPath ? { SWC_BINARY_PATH: swcBinaryPath } : {},
      ),
    },
  ],
};
