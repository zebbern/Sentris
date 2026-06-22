import { afterEach, describe, expect, it, vi } from 'bun:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnOptions } from 'node:child_process';

import {
  TemplateRevalidationService,
  type TemplateRevalidationChildProcess,
  type TemplateRevalidationProcessLauncher,
} from '../template-revalidation.service';

type LauncherMock = TemplateRevalidationProcessLauncher & ReturnType<typeof vi.fn>;

const previousWorkspaceDir = process.env.TEMPLATE_AUDIT_WORKSPACE_DIR;
const previousBunBin = process.env.TEMPLATE_AUDIT_BUN_BIN;

afterEach(() => {
  if (previousWorkspaceDir === undefined) {
    delete process.env.TEMPLATE_AUDIT_WORKSPACE_DIR;
  } else {
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = previousWorkspaceDir;
  }

  if (previousBunBin === undefined) {
    delete process.env.TEMPLATE_AUDIT_BUN_BIN;
  } else {
    process.env.TEMPLATE_AUDIT_BUN_BIN = previousBunBin;
  }
});

function makeSpawnedChild(): TemplateRevalidationChildProcess {
  const child: TemplateRevalidationChildProcess = {
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'spawn') {
        queueMicrotask(() => listener());
      }
      return child;
    }) as unknown as TemplateRevalidationChildProcess['once'],
    unref: vi.fn(),
  };

  return child;
}

function makeFailingChild(error: Error): TemplateRevalidationChildProcess {
  const child: TemplateRevalidationChildProcess = {
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'error') {
        queueMicrotask(() => listener(error));
      }
      return child;
    }) as unknown as TemplateRevalidationChildProcess['once'],
    unref: vi.fn(),
  };

  return child;
}

describe('TemplateRevalidationService', () => {
  it('launches targeted audits with the requesting organization scope', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;
    process.env.TEMPLATE_AUDIT_BUN_BIN = 'bun-test-bin';

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;

    try {
      const result = await new TemplateRevalidationService(undefined, launcher).start({
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
        requestedBy: 'user-1',
        organizationId: 'org-1',
      });

      expect(launcher).toHaveBeenCalledTimes(1);
      const [binary, args, options] = launcher.mock.calls[0] as [string, string[], SpawnOptions];
      expect(binary).toBe('bun-test-bin');
      expect(args).toEqual([
        'scripts/template-library-live-audit.ts',
        '--name',
        'API Surface Exposure Triage',
        '--force',
        '--org-id',
        'org-1',
      ]);
      expect(options.cwd).toBe(workspaceDir);
      expect(options.detached).toBe(true);
      expect(options.env).toMatchObject({
        SENTRIS_ORG_ID: 'org-1',
      });
      expect(String(options.env?.TEMPLATE_AUDIT_OUTPUT_DIR)).toContain(
        join(workspaceDir, '.cache', 'template-revalidations'),
      );
      expect(result).toMatchObject({
        templateName: 'API Surface Exposure Triage',
        status: 'started',
      });
      expect(result.command).toBe(
        'bun run template-library:audit -- --name "API Surface Exposure Triage" --force --org-id "org-1"',
      );
      expect(child.unref).toHaveBeenCalled();
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('writes durable job metadata and log files for launched audits', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;

    try {
      const result = await new TemplateRevalidationService(undefined, launcher).start({
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
        requestedBy: 'user-1',
        organizationId: 'org-1',
      });

      const metadataPath = join(result.outputDir, 'revalidation-job.json');
      expect(existsSync(metadataPath)).toBe(true);
      expect(existsSync(join(result.outputDir, 'stdout.log'))).toBe(true);
      expect(existsSync(join(result.outputDir, 'stderr.log'))).toBe(true);

      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
      expect(metadata).toMatchObject({
        auditId: result.auditId,
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
        requestedBy: 'user-1',
        organizationId: 'org-1',
        status: 'started',
        command: result.command,
        outputDir: result.outputDir,
      });
      expect(typeof metadata.startedAt).toBe('string');
      expect(Date.parse(metadata.startedAt as string)).not.toBeNaN();

      const [, , options] = launcher.mock.calls[0] as [string, string[], SpawnOptions];
      expect(Array.isArray(options.stdio)).toBe(true);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('returns completed status when a revalidation report exists', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;
    const service = new TemplateRevalidationService(undefined, launcher);

    try {
      const result = await service.start({
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
        requestedBy: 'user-1',
        organizationId: 'org-1',
      });
      const reportPath = join(result.outputDir, 'template-live-audit.json');
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generatedAt: '2026-06-21T06:30:00.000Z',
            results: [
              {
                templateName: 'API Surface Exposure Triage',
                recommendation: 'keep',
                terminalStatus: 'COMPLETED',
              },
            ],
          },
          null,
          2,
        ),
      );

      const status = service.getJob(result.auditId);

      expect(status).toMatchObject({
        auditId: result.auditId,
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
        requestedBy: 'user-1',
        organizationId: 'org-1',
        status: 'completed',
        command: result.command,
        outputDir: result.outputDir,
        report: {
          generatedAt: '2026-06-21T06:30:00.000Z',
          resultCount: 1,
          recommendations: ['keep'],
          terminalStatuses: ['COMPLETED'],
        },
      });
      expect(typeof status.startedAt).toBe('string');
      expect(status.outputFiles).toMatchObject({
        marker: join(result.outputDir, 'revalidation-job.json'),
        stdout: join(result.outputDir, 'stdout.log'),
        stderr: join(result.outputDir, 'stderr.log'),
        reportJson: reportPath,
        reportMarkdown: join(result.outputDir, 'template-live-audit.md'),
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('lists recent revalidation jobs newest first with an optional limit', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;
    const service = new TemplateRevalidationService(undefined, launcher);

    try {
      const oldJob = await service.start({
        templateId: 'tpl-old',
        templateName: 'Old Template',
      });
      const newestJob = await service.start({
        templateId: 'tpl-new',
        templateName: 'Newest Template',
      });
      const middleJob = await service.start({
        templateId: 'tpl-middle',
        templateName: 'Middle Template',
      });

      writeFileSync(
        join(oldJob.outputDir, 'revalidation-job.json'),
        `${JSON.stringify(
          {
            auditId: oldJob.auditId,
            templateId: 'tpl-old',
            templateName: 'Old Template',
            requestedBy: null,
            organizationId: null,
            status: 'started',
            command: oldJob.command,
            outputDir: oldJob.outputDir,
            startedAt: '2026-06-21T06:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(newestJob.outputDir, 'revalidation-job.json'),
        `${JSON.stringify(
          {
            auditId: newestJob.auditId,
            templateId: 'tpl-new',
            templateName: 'Newest Template',
            requestedBy: null,
            organizationId: null,
            status: 'started',
            command: newestJob.command,
            outputDir: newestJob.outputDir,
            startedAt: '2026-06-21T08:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(middleJob.outputDir, 'revalidation-job.json'),
        `${JSON.stringify(
          {
            auditId: middleJob.auditId,
            templateId: 'tpl-middle',
            templateName: 'Middle Template',
            requestedBy: null,
            organizationId: null,
            status: 'started',
            command: middleJob.command,
            outputDir: middleJob.outputDir,
            startedAt: '2026-06-21T07:00:00.000Z',
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(newestJob.outputDir, 'template-live-audit.json'),
        JSON.stringify(
          {
            generatedAt: '2026-06-21T08:10:00.000Z',
            results: [
              {
                templateName: 'Newest Template',
                recommendation: 'keep',
                terminalStatus: 'COMPLETED',
              },
            ],
          },
          null,
          2,
        ),
      );

      const jobs = service.listJobs(2);

      expect(jobs.map((job) => job.templateName)).toEqual(['Newest Template', 'Middle Template']);
      expect(jobs[0]).toMatchObject({
        auditId: newestJob.auditId,
        status: 'completed',
        report: {
          generatedAt: '2026-06-21T08:10:00.000Z',
          resultCount: 1,
          recommendations: ['keep'],
          terminalStatuses: ['COMPLETED'],
        },
      });
      expect(jobs[1]).toMatchObject({
        auditId: middleJob.auditId,
        status: 'started',
        report: null,
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('skips unreadable revalidation jobs when listing recent history', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;
    const service = new TemplateRevalidationService(undefined, launcher);

    try {
      const validJob = await service.start({
        templateId: 'tpl-valid',
        templateName: 'Valid Template',
      });
      const corruptJob = await service.start({
        templateId: 'tpl-corrupt',
        templateName: 'Corrupt Template',
      });
      writeFileSync(join(corruptJob.outputDir, 'revalidation-job.json'), '{not json');

      const jobs = service.listJobs();

      expect(jobs.map((job) => job.auditId)).toEqual([validJob.auditId]);
      expect(jobs[0].templateName).toBe('Valid Template');
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('returns a bounded log tail for a revalidation job', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;
    const service = new TemplateRevalidationService(undefined, launcher);

    try {
      const result = await service.start({
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
      });
      writeFileSync(join(result.outputDir, 'stderr.log'), '0123456789abcdef');

      const logTail = service.getJobLog(result.auditId, 'stderr', 6);

      expect(logTail).toEqual({
        auditId: result.auditId,
        stream: 'stderr',
        content: 'abcdef',
        bytes: 6,
        maxBytes: 6,
        truncated: true,
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('rejects invalid revalidation log streams', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const child = makeSpawnedChild();
    const launcher = vi.fn(
      (_binary: string, _args: string[], _options: SpawnOptions) => child,
    ) as unknown as LauncherMock;
    const service = new TemplateRevalidationService(undefined, launcher);

    try {
      const result = await service.start({
        templateId: 'tpl-1',
        templateName: 'API Surface Exposure Triage',
      });

      expect(() => service.getJobLog(result.auditId, '../secret' as 'stderr')).toThrow(
        BadRequestException,
      );
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('surfaces launcher failures as service unavailable', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sentris-template-revalidation-'));
    process.env.TEMPLATE_AUDIT_WORKSPACE_DIR = workspaceDir;

    const launcher = vi.fn(() =>
      makeFailingChild(new Error('missing bun')),
    ) as unknown as LauncherMock;

    try {
      await expect(
        new TemplateRevalidationService(undefined, launcher).start({
          templateId: 'tpl-1',
          templateName: 'API Surface Exposure Triage',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
