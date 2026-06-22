import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@sentris/component-sdk';

const initializedVolumes: Record<string, string | Buffer>[] = [];
const volumeConfigs: { source: string; target: string; readOnly: boolean }[] = [];
let readFilesResult: Record<string, string> = {};
let readFilesError: Error | undefined;

mock.module('../../../utils/isolated-volume', () => ({
  IsolatedContainerVolume: class {
    async initialize(files: Record<string, string | Buffer>) {
      initializedVolumes.push(files);
      return 'mock-volume';
    }

    getVolumeConfig(containerPath = '/inputs', readOnly = true) {
      const config = { source: 'mock-volume', target: containerPath, readOnly };
      volumeConfigs.push(config);
      return config;
    }

    getVolumeName() {
      return 'mock-volume';
    }

    async readFiles() {
      if (readFilesError) throw readFilesError;
      return readFilesResult;
    }

    async cleanup() {}
  },
}));

let componentRegistry: typeof import('@sentris/component-sdk').componentRegistry;

describe('scanner bundle materialization integration', () => {
  beforeAll(async () => {
    await import('../semgrep');
    await import('../checkov');
    ({ componentRegistry } = await import('@sentris/component-sdk'));
  });

  beforeEach(() => {
    initializedVolumes.length = 0;
    volumeConfigs.length = 0;
    readFilesResult = {};
    readFilesError = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes Semgrep FILE marker bundles as extension-preserving scanner files', async () => {
    const component = componentRegistry.get<any, any>('sentris.semgrep.run');
    if (!component) throw new Error('Semgrep component was not registered');

    const semgrepJson = JSON.stringify({
      results: [
        {
          check_id: 'javascript.express.security.audit.xss',
          path: '/inputs/001-src__server.js',
          start: { line: 1 },
          end: { line: 1 },
          extra: {
            message: 'Potential reflected XSS',
            severity: 'ERROR',
            metadata: { cwe: ['CWE-79'] },
          },
        },
      ],
    });
    readFilesResult = { 'semgrep-results.json': semgrepJson };
    const runSpy = vi
      .spyOn(sdk, 'runComponentWithRunner')
      .mockResolvedValue('Semgrep CLI\nScan completed successfully. Findings: 1');

    const result = (await component.execute(
      {
        inputs: {
          target: [
            '# FILE: src/server.js',
            'app.get("/search", (req, res) => res.send(req.query.q));',
            '# FILE: src/util.ts',
            'export const escape = (value: string) => value;',
          ].join('\n'),
        },
        params: {
          config: 'p/owasp-top-ten',
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'semgrep-bundle' }),
    )) as { findingCount: number; findings: { checkId: string; severity: string }[] };
    const semgrepCommand = (runSpy.mock.calls[0]?.[0] as { command?: string[] } | undefined)
      ?.command;

    expect(Object.keys(initializedVolumes[0] ?? {})).toEqual([
      '001-src__server.js',
      '002-src__util.ts',
    ]);
    expect(semgrepCommand).not.toContain('--no-git');
    expect(semgrepCommand).toContain('--quiet');
    expect(semgrepCommand).toContain('--json-output=/inputs/semgrep-results.json');
    expect(volumeConfigs[0]?.readOnly).toBe(false);
    expect(result.findingCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      checkId: 'javascript.express.security.audit.xss',
      severity: 'ERROR',
    });
  });

  it('falls back to Semgrep stdout JSON when the result file cannot be read', async () => {
    const component = componentRegistry.get<any, any>('sentris.semgrep.run');
    if (!component) throw new Error('Semgrep component was not registered');

    readFilesError = new Error('volume read failed');
    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        results: [
          {
            check_id: 'javascript.express.security.audit.xss',
            path: '/inputs/target-code.txt',
            start: { line: 1 },
            end: { line: 1 },
            extra: {
              message: 'Potential reflected XSS',
              severity: 'ERROR',
              metadata: { cwe: ['CWE-79'] },
            },
          },
        ],
      }),
    );

    const result = (await component.execute(
      {
        inputs: {
          target: 'app.get("/search", (req, res) => res.send(req.query.q));',
        },
        params: {
          config: 'p/owasp-top-ten',
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'semgrep-stdout-fallback' }),
    )) as { findingCount: number; findings: { checkId: string; severity: string }[] };

    expect(result.findingCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      checkId: 'javascript.express.security.audit.xss',
      severity: 'ERROR',
    });
  });

  it('writes Checkov FILE marker bundles as extension-preserving scanner files', async () => {
    const component = componentRegistry.get<any, any>('sentris.checkov.run');
    if (!component) throw new Error('Checkov component was not registered');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      JSON.stringify({
        results: {
          passed_checks: [],
          failed_checks: [
            {
              check_id: 'CKV_AWS_20',
              check_name: 'S3 Bucket has an ACL defined which allows public READ access.',
              check_result: { result: 'FAILED' },
              resource: 'aws_s3_bucket.public',
              file_path: '/input/001-infra__main.tf',
              file_line_range: [1, 4],
              severity: 'HIGH',
              guideline: 'https://docs.bridgecrew.io/docs/s3_1-acl-read-permissions-everyone',
            },
          ],
        },
      }),
    );

    const result = (await component.execute(
      {
        inputs: {
          target: [
            '# FILE: infra/main.tf',
            'resource "aws_s3_bucket" "public" {}',
            '# FILE: infra/variables.tf',
            'variable "bucket_name" { type = string }',
          ].join('\n'),
        },
        params: {
          framework: 'terraform',
          compact: true,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'checkov-bundle' }),
    )) as {
      failedCount: number;
      violations: { checkId: string; severity?: string; resource: string }[];
    };

    expect(Object.keys(initializedVolumes[0] ?? {})).toEqual([
      '001-infra__main.tf',
      '002-infra__variables.tf',
    ]);
    expect(result.failedCount).toBe(1);
    expect(result.violations[0]).toMatchObject({
      checkId: 'CKV_AWS_20',
      severity: 'HIGH',
      resource: 'aws_s3_bucket.public',
    });
  });

  it('parses Checkov JSON when runner output includes surrounding log text', async () => {
    const component = componentRegistry.get<any, any>('sentris.checkov.run');
    if (!component) throw new Error('Checkov component was not registered');

    vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue(
      [
        '2026-06-21T21:00:00Z INFO checkov starting',
        JSON.stringify({
          results: {
            passed_checks: [{ check_id: 'CKV_AWS_1' }],
            failed_checks: [
              {
                check_id: 'CKV_AWS_20',
                check_name: 'S3 Bucket has an ACL defined which allows public READ access.',
                check_result: { result: 'FAILED' },
                resource: 'aws_s3_bucket.public',
                file_path: '/input/main.tf',
                file_line_range: [1, 4],
                severity: 'HIGH',
                guideline: 'https://docs.bridgecrew.io/docs/s3_1-acl-read-permissions-everyone',
              },
            ],
          },
        }),
        'scan finished',
      ].join('\n'),
    );

    const result = (await component.execute(
      {
        inputs: {
          target: 'resource "aws_s3_bucket" "public" {}',
        },
        params: {
          framework: 'terraform',
          compact: true,
        },
      },
      sdk.createExecutionContext({ runId: 'test-run', componentRef: 'checkov-mixed-output' }),
    )) as {
      passedCount: number;
      failedCount: number;
      violations: { checkId: string; severity?: string; resource: string }[];
      results: { severity: string; check_id: string }[];
    };

    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.violations[0]).toMatchObject({
      checkId: 'CKV_AWS_20',
      severity: 'HIGH',
      resource: 'aws_s3_bucket.public',
    });
    expect(result.results[0]).toMatchObject({
      severity: 'high',
      check_id: 'CKV_AWS_20',
    });
  });
});
