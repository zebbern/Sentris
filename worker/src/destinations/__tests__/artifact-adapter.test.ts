import { describe, it, expect, vi } from 'bun:test';
import { ConfigurationError } from '@sentris/component-sdk';
import type { ExecutionContext, IArtifactService } from '@sentris/component-sdk';
import { artifactDestinationAdapter } from '../adapters/artifact';
import type { DestinationSaveInput } from '../registry';

function createMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    runId: 'run-test-123',
    componentRef: 'node-1',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    emitProgress: vi.fn(),
    metadata: {
      runId: 'run-test-123',
      workflowId: 'wf-1',
      workflowVersionId: 'wfv-1',
      componentId: 'comp-1',
      componentRef: 'node-1',
    },
    http: {
      fetch: vi.fn(),
      toCurl: vi.fn(),
    },
    ...overrides,
  } as unknown as ExecutionContext;
}

function createSaveInput(overrides: Partial<DestinationSaveInput> = {}): DestinationSaveInput {
  return {
    fileName: overrides.fileName ?? 'report.pdf',
    mimeType: overrides.mimeType ?? 'application/pdf',
    buffer: overrides.buffer ?? Buffer.from('test-content'),
    metadata: overrides.metadata,
  };
}

describe('artifactDestinationAdapter', () => {
  describe('registration metadata', () => {
    it('has the correct id', () => {
      expect(artifactDestinationAdapter.id).toBe('artifact');
    });

    it('has a label and description', () => {
      expect(artifactDestinationAdapter.label).toBe('Run / Artifact Library');
      expect(artifactDestinationAdapter.description).toBeDefined();
    });

    it('declares parameters', () => {
      expect(artifactDestinationAdapter.parameters).toBeDefined();
      expect(artifactDestinationAdapter.parameters!.length).toBeGreaterThan(0);
      expect(artifactDestinationAdapter.parameters![0].id).toBe('destinations');
    });
  });

  describe('create', () => {
    it('returns an adapter with a save method', () => {
      const adapter = artifactDestinationAdapter.create({});

      expect(adapter).toBeDefined();
      expect(typeof adapter.save).toBe('function');
    });
  });

  describe('save', () => {
    it('uploads to artifact service with default destination "run"', async () => {
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-001',
        fileId: 'file-001',
        name: 'report.pdf',
        destinations: ['run'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      const adapter = artifactDestinationAdapter.create({});
      const input = createSaveInput();

      const result = await adapter.save(input, context);

      expect(uploadMock).toHaveBeenCalledTimes(1);
      const payload = uploadMock.mock.calls[0][0];
      expect(payload.name).toBe('report.pdf');
      expect(payload.mimeType).toBe('application/pdf');
      expect(payload.destinations).toEqual(['run']);
      expect(result.artifactId).toBe('art-001');
      expect(result.destinations).toEqual(['run']);
    });

    it('uses configured destinations when provided', async () => {
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-002',
        fileId: 'file-002',
        name: 'scan.json',
        destinations: ['run', 'library'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      const adapter = artifactDestinationAdapter.create({
        destinations: ['run', 'library'],
      });
      const input = createSaveInput({ fileName: 'scan.json', mimeType: 'application/json' });

      const result = await adapter.save(input, context);

      const payload = uploadMock.mock.calls[0][0];
      expect(payload.destinations).toEqual(['run', 'library']);
      expect(result.destinations).toEqual(['run', 'library']);
    });

    it('defaults to ["run"] when destinations config is not an array', async () => {
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-003',
        fileId: 'file-003',
        name: 'report.pdf',
        destinations: ['run'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      // Pass a non-array value for destinations
      const adapter = artifactDestinationAdapter.create({ destinations: 'invalid' });
      const input = createSaveInput();

      await adapter.save(input, context);

      const payload = uploadMock.mock.calls[0][0];
      expect(payload.destinations).toEqual(['run']);
    });

    it('passes metadata through to artifact service', async () => {
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-004',
        fileId: 'file-004',
        name: 'data.csv',
        destinations: ['run'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      const adapter = artifactDestinationAdapter.create({});
      const metadata = { source: 'scanner', version: '1.0' };
      const input = createSaveInput({ metadata });

      await adapter.save(input, context);

      const payload = uploadMock.mock.calls[0][0];
      expect(payload.metadata).toEqual({ source: 'scanner', version: '1.0' });
    });

    it('passes buffer content through to artifact service', async () => {
      const testContent = 'binary-data-here';
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-005',
        fileId: 'file-005',
        name: 'file.bin',
        destinations: ['run'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      const adapter = artifactDestinationAdapter.create({});
      const input = createSaveInput({
        fileName: 'file.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(testContent),
      });

      await adapter.save(input, context);

      const payload = uploadMock.mock.calls[0][0];
      expect(payload.content.toString('utf-8')).toBe(testContent);
    });

    it('throws ConfigurationError when artifact service is unavailable', async () => {
      const context = createMockContext({ artifacts: undefined });
      const adapter = artifactDestinationAdapter.create({});
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('defaults empty destinations array to ["run"]', async () => {
      const uploadMock = vi.fn().mockResolvedValue({
        artifactId: 'art-006',
        fileId: 'file-006',
        name: 'report.pdf',
        destinations: ['run'],
      });

      const artifacts: IArtifactService = {
        upload: uploadMock,
        download: vi.fn(),
      };

      const context = createMockContext({ artifacts });
      const adapter = artifactDestinationAdapter.create({ destinations: [] });
      const input = createSaveInput();

      await adapter.save(input, context);

      const payload = uploadMock.mock.calls[0][0];
      expect(payload.destinations).toEqual(['run']);
    });
  });
});
