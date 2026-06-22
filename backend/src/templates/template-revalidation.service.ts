import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export const TEMPLATE_REVALIDATION_RUNNER = Symbol('TEMPLATE_REVALIDATION_RUNNER');
export const TEMPLATE_REVALIDATION_PROCESS_LAUNCHER = Symbol(
  'TEMPLATE_REVALIDATION_PROCESS_LAUNCHER',
);

export interface TemplateRevalidationRequest {
  templateId: string;
  templateName: string;
  requestedBy?: string;
  organizationId?: string;
}

export interface TemplateRevalidationJob {
  auditId: string;
  templateName: string;
  status: 'started';
  command: string;
  outputDir: string;
}

export interface TemplateRevalidationJobStatus {
  auditId: string;
  templateId: string;
  templateName: string;
  requestedBy: string | null;
  organizationId: string | null;
  status: 'started' | 'completed';
  command: string;
  outputDir: string;
  startedAt: string;
  outputFiles: {
    marker: string;
    stdout: string;
    stderr: string;
    reportJson: string;
    reportMarkdown: string;
  };
  report: {
    generatedAt?: string;
    resultCount: number;
    recommendations: string[];
    terminalStatuses: string[];
  } | null;
}

export type TemplateRevalidationLogStream = 'stdout' | 'stderr';

export interface TemplateRevalidationJobLog {
  auditId: string;
  stream: TemplateRevalidationLogStream;
  content: string;
  bytes: number;
  maxBytes: number;
  truncated: boolean;
}

export type TemplateRevalidationRunner = (
  request: TemplateRevalidationRequest,
) => Promise<TemplateRevalidationJob> | TemplateRevalidationJob;

export interface TemplateRevalidationChildProcess {
  once(eventName: 'spawn', listener: () => void): TemplateRevalidationChildProcess;
  once(eventName: 'error', listener: (error: Error) => void): TemplateRevalidationChildProcess;
  once(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): TemplateRevalidationChildProcess;
  unref(): void;
}

export type TemplateRevalidationProcessLauncher = (
  binary: string,
  args: string[],
  options: SpawnOptions,
) => TemplateRevalidationChildProcess;

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function buildTemplateAuditCommand(templateName: string, organizationId?: string) {
  return [
    'bun run template-library:audit --',
    '--name',
    quoteEnvValue(templateName),
    '--force',
    organizationId ? '--org-id' : null,
    organizationId ? quoteEnvValue(organizationId) : null,
  ]
    .filter(Boolean)
    .join(' ');
}

const REVALIDATION_AUDIT_ID_PATTERN =
  /^template-revalidation-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveWorkspaceRoot() {
  const explicit = process.env.TEMPLATE_AUDIT_WORKSPACE_DIR;
  if (explicit) return explicit;

  const cwd = process.cwd();
  if (existsSync(join(cwd, 'scripts', 'template-library-live-audit.ts'))) {
    return cwd;
  }

  return resolve(cwd, '..');
}

function resolveRevalidationRoot() {
  return join(resolveWorkspaceRoot(), '.cache', 'template-revalidations');
}

function resolveBunBinary() {
  if (process.env.TEMPLATE_AUDIT_BUN_BIN) return process.env.TEMPLATE_AUDIT_BUN_BIN;
  const versions = process.versions as NodeJS.ProcessVersions & { bun?: string };
  return versions.bun ? process.execPath : 'bun';
}

function closeFileDescriptor(fd: number | undefined) {
  if (fd === undefined) return;

  try {
    closeSync(fd);
  } catch {
    // The descriptor may already be closed if process launch fails in platform-specific ways.
  }
}

function readJsonObject(filePath: string) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ServiceUnavailableException({
      message: 'Failed to read template revalidation metadata',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function readRequiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new ServiceUnavailableException(`Template revalidation metadata is missing ${key}`);
  }
  return value;
}

function readNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ServiceUnavailableException(`Template revalidation metadata has invalid ${key}`);
  }
  return value;
}

function summarizeReport(report: Record<string, unknown>) {
  const results = Array.isArray(report.results) ? report.results : [];
  const recommendations: string[] = [];
  const terminalStatuses: string[] = [];

  for (const result of results) {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) continue;
    const record = result as Record<string, unknown>;
    if (typeof record.recommendation === 'string') {
      recommendations.push(record.recommendation);
    }
    if (typeof record.terminalStatus === 'string') {
      terminalStatuses.push(record.terminalStatus);
    }
  }

  return {
    ...(typeof report.generatedAt === 'string' ? { generatedAt: report.generatedAt } : {}),
    resultCount: results.length,
    recommendations,
    terminalStatuses,
  };
}

function normalizeJobLimit(limit: number | undefined) {
  if (!Number.isFinite(limit) || limit === undefined || limit <= 0) return 10;
  return Math.min(Math.floor(limit), 50);
}

function normalizeLogMaxBytes(maxBytes: number | undefined) {
  if (!Number.isFinite(maxBytes) || maxBytes === undefined || maxBytes <= 0) return 20_000;
  return Math.min(Math.floor(maxBytes), 65_536);
}

function normalizeLogStream(stream: string): TemplateRevalidationLogStream {
  if (stream === 'stdout' || stream === 'stderr') return stream;
  throw new BadRequestException('Invalid template revalidation log stream');
}

@Injectable()
export class TemplateRevalidationService {
  private readonly logger = new Logger(TemplateRevalidationService.name);

  constructor(
    @Optional()
    @Inject(TEMPLATE_REVALIDATION_RUNNER)
    private readonly runner?: TemplateRevalidationRunner,
    @Optional()
    @Inject(TEMPLATE_REVALIDATION_PROCESS_LAUNCHER)
    private readonly processLauncher?: TemplateRevalidationProcessLauncher,
  ) {}

  async start(request: TemplateRevalidationRequest): Promise<TemplateRevalidationJob> {
    if (this.runner) {
      return await this.runner(request);
    }

    const auditId = `template-revalidation-${randomUUID()}`;
    const workspaceRoot = resolveWorkspaceRoot();
    const outputDir = join(resolveRevalidationRoot(), auditId);
    mkdirSync(outputDir, { recursive: true });

    const command = buildTemplateAuditCommand(request.templateName, request.organizationId);

    const launchProcess = this.processLauncher ?? spawn;
    const stdoutPath = join(outputDir, 'stdout.log');
    const stderrPath = join(outputDir, 'stderr.log');
    let stdoutFd: number | undefined;
    let stderrFd: number | undefined;

    try {
      stdoutFd = openSync(stdoutPath, 'a');
      stderrFd = openSync(stderrPath, 'a');
      writeFileSync(
        join(outputDir, 'revalidation-job.json'),
        `${JSON.stringify(
          {
            auditId,
            templateId: request.templateId,
            templateName: request.templateName,
            requestedBy: request.requestedBy ?? null,
            organizationId: request.organizationId ?? null,
            status: 'started',
            command,
            outputDir,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );

      const child = launchProcess(
        resolveBunBinary(),
        [
          'scripts/template-library-live-audit.ts',
          '--name',
          request.templateName,
          '--force',
          ...(request.organizationId ? ['--org-id', request.organizationId] : []),
        ],
        {
          cwd: workspaceRoot,
          detached: true,
          env: {
            ...process.env,
            TEMPLATE_AUDIT_OUTPUT_DIR: outputDir,
            ...(request.organizationId ? { SENTRIS_ORG_ID: request.organizationId } : {}),
          },
          stdio: ['ignore', stdoutFd, stderrFd],
          windowsHide: true,
        },
      );

      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        child.once('spawn', () => resolveSpawn());
        child.once('error', rejectSpawn);
      });

      child.unref();
    } catch (error) {
      throw new ServiceUnavailableException({
        message: 'Failed to start template revalidation',
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      closeFileDescriptor(stdoutFd);
      closeFileDescriptor(stderrFd);
    }

    this.logger.log(
      `Started template revalidation ${auditId} for ${request.templateName} (${request.templateId})`,
    );

    return {
      auditId,
      templateName: request.templateName,
      status: 'started',
      command,
      outputDir,
    };
  }

  getJob(auditId: string): TemplateRevalidationJobStatus {
    if (!REVALIDATION_AUDIT_ID_PATTERN.test(auditId)) {
      throw new BadRequestException('Invalid template revalidation audit id');
    }

    const outputDir = join(resolveRevalidationRoot(), auditId);
    const markerPath = join(outputDir, 'revalidation-job.json');
    const stdoutPath = join(outputDir, 'stdout.log');
    const stderrPath = join(outputDir, 'stderr.log');
    const reportJsonPath = join(outputDir, 'template-live-audit.json');
    const reportMarkdownPath = join(outputDir, 'template-live-audit.md');

    if (!existsSync(markerPath)) {
      throw new NotFoundException(`Template revalidation job ${auditId} not found`);
    }

    const metadata = readJsonObject(markerPath);
    const metadataAuditId = readRequiredString(metadata, 'auditId');
    if (metadataAuditId !== auditId) {
      throw new ServiceUnavailableException('Template revalidation metadata audit id mismatch');
    }

    const report = existsSync(reportJsonPath)
      ? summarizeReport(readJsonObject(reportJsonPath))
      : null;

    return {
      auditId,
      templateId: readRequiredString(metadata, 'templateId'),
      templateName: readRequiredString(metadata, 'templateName'),
      requestedBy: readNullableString(metadata, 'requestedBy'),
      organizationId: readNullableString(metadata, 'organizationId'),
      status: report ? 'completed' : 'started',
      command: readRequiredString(metadata, 'command'),
      outputDir: readRequiredString(metadata, 'outputDir'),
      startedAt: readRequiredString(metadata, 'startedAt'),
      outputFiles: {
        marker: markerPath,
        stdout: stdoutPath,
        stderr: stderrPath,
        reportJson: reportJsonPath,
        reportMarkdown: reportMarkdownPath,
      },
      report,
    };
  }

  listJobs(limit?: number): TemplateRevalidationJobStatus[] {
    const revalidationRoot = resolveRevalidationRoot();
    if (!existsSync(revalidationRoot)) return [];

    const jobs: TemplateRevalidationJobStatus[] = [];
    for (const entry of readdirSync(revalidationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !REVALIDATION_AUDIT_ID_PATTERN.test(entry.name)) continue;

      try {
        jobs.push(this.getJob(entry.name));
      } catch (error) {
        this.logger.warn(
          `Skipping unreadable template revalidation job ${entry.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return jobs
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, normalizeJobLimit(limit));
  }

  getJobLog(auditId: string, stream: string, maxBytes?: number): TemplateRevalidationJobLog {
    const normalizedStream = normalizeLogStream(stream);
    const normalizedMaxBytes = normalizeLogMaxBytes(maxBytes);
    const job = this.getJob(auditId);
    const logPath = job.outputFiles[normalizedStream];

    if (!existsSync(logPath)) {
      return {
        auditId,
        stream: normalizedStream,
        content: '',
        bytes: 0,
        maxBytes: normalizedMaxBytes,
        truncated: false,
      };
    }

    const size = statSync(logPath).size;
    const bytesToRead = Math.min(size, normalizedMaxBytes);
    if (bytesToRead === 0) {
      return {
        auditId,
        stream: normalizedStream,
        content: '',
        bytes: 0,
        maxBytes: normalizedMaxBytes,
        truncated: false,
      };
    }

    const buffer = Buffer.alloc(bytesToRead);
    let fd: number | undefined;
    let bytesRead = 0;

    try {
      fd = openSync(logPath, 'r');
      bytesRead = readSync(fd, buffer, 0, bytesToRead, size - bytesToRead);
    } finally {
      closeFileDescriptor(fd);
    }

    return {
      auditId,
      stream: normalizedStream,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      bytes: bytesRead,
      maxBytes: normalizedMaxBytes,
      truncated: size > bytesRead,
    };
  }
}
