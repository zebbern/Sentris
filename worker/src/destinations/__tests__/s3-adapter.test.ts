import { describe, it, expect, beforeEach, mock, vi } from 'bun:test';
import { ConfigurationError } from '@sentris/component-sdk';
import type { ExecutionContext } from '@sentris/component-sdk';
import type { DestinationSaveInput } from '../registry';

// ── S3 SDK mock ──────────────────────────────────────────────────────────────
const s3SendMock = vi.fn();

mock.module('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: s3SendMock })),
  PutObjectCommand: vi.fn((input: unknown) => ({ input })),
}));

// Import AFTER mock.module so the mock is applied
import { s3DestinationAdapter } from '../adapters/s3';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createMockContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    runId: 'run-s3-test',
    componentRef: 'node-s3',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    emitProgress: vi.fn(),
    metadata: {
      runId: 'run-s3-test',
      workflowId: 'wf-1',
      workflowVersionId: 'wfv-1',
      componentId: 'comp-1',
      componentRef: 'node-s3',
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
    buffer: overrides.buffer ?? Buffer.from('s3-test-content'),
    metadata: overrides.metadata,
  };
}

function validS3Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bucket: 'test-bucket',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('s3DestinationAdapter', () => {
  beforeEach(() => {
    s3SendMock.mockReset();
    s3SendMock.mockResolvedValue({ ETag: '"abc123"' });
  });

  describe('registration metadata', () => {
    it('has the correct id', () => {
      expect(s3DestinationAdapter.id).toBe('s3');
    });

    it('has a label and description', () => {
      expect(s3DestinationAdapter.label).toBe('Amazon S3');
      expect(s3DestinationAdapter.description).toBeDefined();
    });

    it('declares required parameters including bucket', () => {
      const bucketParam = s3DestinationAdapter.parameters?.find((p) => p.id === 'bucket');
      expect(bucketParam).toBeDefined();
      expect(bucketParam?.required).toBe(true);
    });
  });

  describe('create', () => {
    it('returns an adapter with a save method', () => {
      const adapter = s3DestinationAdapter.create(validS3Config());

      expect(adapter).toBeDefined();
      expect(typeof adapter.save).toBe('function');
    });
  });

  describe('config validation', () => {
    it('throws ConfigurationError when bucket is missing', async () => {
      const adapter = s3DestinationAdapter.create({ credentials: validS3Config().credentials });
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when bucket is empty string', async () => {
      const adapter = s3DestinationAdapter.create({
        bucket: '',
        credentials: validS3Config().credentials,
      });
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when config is null', async () => {
      const adapter = s3DestinationAdapter.create(null as unknown as Record<string, unknown>);
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when credentials are missing', async () => {
      const adapter = s3DestinationAdapter.create({ bucket: 'my-bucket' });
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when accessKeyId is missing', async () => {
      const adapter = s3DestinationAdapter.create({
        bucket: 'my-bucket',
        credentials: { secretAccessKey: 'secret' },
      });
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });

    it('throws ConfigurationError when secretAccessKey is missing', async () => {
      const adapter = s3DestinationAdapter.create({
        bucket: 'my-bucket',
        credentials: { accessKeyId: 'AKIA...' },
      });
      const context = createMockContext();
      const input = createSaveInput();

      await expect(adapter.save(input, context)).rejects.toThrow(ConfigurationError);
    });
  });

  describe('save (upload)', () => {
    it('uploads a file to S3 with correct parameters', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'scan.json', mimeType: 'application/json' });

      const result = await adapter.save(input, context);

      expect(s3SendMock).toHaveBeenCalledTimes(1);
      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Bucket).toBe('test-bucket');
      expect(command.input.Key).toBe('scan.json');
      expect(command.input.ContentType).toBe('application/json');
      expect(result.remoteUploads).toBeDefined();
      expect(result.remoteUploads).toHaveLength(1);
      expect(result.remoteUploads![0].type).toBe('s3');
      expect(result.remoteUploads![0].bucket).toBe('test-bucket');
      expect(result.remoteUploads![0].key).toBe('scan.json');
      expect(result.remoteUploads![0].uri).toBe('s3://test-bucket/scan.json');
    });

    it('includes sentris metadata headers in the upload', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput();

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Metadata['sentris-run-id']).toBe('run-s3-test');
      expect(command.input.Metadata['sentris-component-ref']).toBe('node-s3');
    });

    it('strips ETag quotes from response', async () => {
      s3SendMock.mockResolvedValue({ ETag: '"etag-value-123"' });
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput();

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].etag).toBe('etag-value-123');
    });

    it('handles ETag without quotes', async () => {
      s3SendMock.mockResolvedValue({ ETag: 'raw-etag' });
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput();

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].etag).toBe('raw-etag');
    });

    it('handles undefined ETag in response', async () => {
      s3SendMock.mockResolvedValue({});
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput();

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].etag).toBeUndefined();
    });

    it('logs upload info', async () => {
      const loggerInfo = vi.fn();
      const context = createMockContext({
        logger: {
          info: loggerInfo,
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        } as unknown as ExecutionContext['logger'],
      });
      const adapter = s3DestinationAdapter.create(validS3Config());
      const input = createSaveInput({ fileName: 'output.csv' });

      await adapter.save(input, context);

      expect(loggerInfo).toHaveBeenCalled();
      const logMsg = loggerInfo.mock.calls[0][0] as string;
      expect(logMsg).toContain('output.csv');
      expect(logMsg).toContain('test-bucket');
    });
  });

  describe('object key resolution', () => {
    it('uses fileName as key when no objectKey or pathPrefix configured', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'data.json' });

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Key).toBe('data.json');
    });

    it('prepends pathPrefix to fileName', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config({ pathPrefix: 'scans/2024' }));
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'report.pdf' });

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Key).toBe('scans/2024/report.pdf');
    });

    it('strips leading slashes from pathPrefix', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config({ pathPrefix: '/leading/slash/' }));
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'file.txt' });

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Key).toBe('leading/slash/file.txt');
    });

    it('uses explicit objectKey over pathPrefix', async () => {
      const adapter = s3DestinationAdapter.create(
        validS3Config({ objectKey: 'custom/path/object.bin', pathPrefix: 'ignored' }),
      );
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'ignored-name.pdf' });

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Key).toBe('custom/path/object.bin');
    });

    it('strips leading slashes from objectKey', async () => {
      const adapter = s3DestinationAdapter.create(
        validS3Config({ objectKey: '/leading/key.json' }),
      );
      const context = createMockContext();
      const input = createSaveInput();

      await adapter.save(input, context);

      const command = s3SendMock.mock.calls[0][0];
      expect(command.input.Key).toBe('leading/key.json');
    });
  });

  describe('region and endpoint configuration', () => {
    it('uses default region us-east-1 when none specified', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.region).toBe('us-east-1');
    });

    it('uses config region when specified', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(validS3Config({ region: 'eu-west-1' }));
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.region).toBe('eu-west-1');
    });

    it('uses credential region over config region', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(
        validS3Config({
          region: 'us-west-2',
          credentials: {
            accessKeyId: 'AKIA...',
            secretAccessKey: 'secret',
            region: 'ap-southeast-1',
          },
        }),
      );
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.region).toBe('ap-southeast-1');
    });

    it('passes custom endpoint to S3Client', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(
        validS3Config({ endpoint: 'https://minio.local:9000' }),
      );
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.endpoint).toBe('https://minio.local:9000');
    });

    it('passes forcePathStyle to S3Client', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(validS3Config({ forcePathStyle: true }));
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.forcePathStyle).toBe(true);
    });
  });

  describe('public URL', () => {
    it('includes publicUrl in result when configured', async () => {
      const adapter = s3DestinationAdapter.create(
        validS3Config({ publicUrl: 'https://cdn.example.com' }),
      );
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'asset.png' });

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].url).toBe('https://cdn.example.com/asset.png');
    });

    it('strips trailing slashes from publicUrl', async () => {
      const adapter = s3DestinationAdapter.create(
        validS3Config({ publicUrl: 'https://cdn.example.com/' }),
      );
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'file.txt' });

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].url).toBe('https://cdn.example.com/file.txt');
    });

    it('produces url with pathPrefix', async () => {
      const adapter = s3DestinationAdapter.create(
        validS3Config({ publicUrl: 'https://cdn.example.com', pathPrefix: 'artifacts' }),
      );
      const context = createMockContext();
      const input = createSaveInput({ fileName: 'doc.pdf' });

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].url).toBe('https://cdn.example.com/artifacts/doc.pdf');
    });

    it('returns undefined url when publicUrl not configured', async () => {
      const adapter = s3DestinationAdapter.create(validS3Config());
      const context = createMockContext();
      const input = createSaveInput();

      const result = await adapter.save(input, context);

      expect(result.remoteUploads![0].url).toBeUndefined();
    });
  });

  describe('session token', () => {
    it('passes sessionToken to S3Client credentials', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const adapter = s3DestinationAdapter.create(
        validS3Config({
          credentials: {
            accessKeyId: 'AKIA...',
            secretAccessKey: 'secret',
            sessionToken: 'FwoGZXIvYXdzE...',
          },
        }),
      );
      const context = createMockContext();

      await adapter.save(createSaveInput(), context);

      const s3Constructor = S3Client as unknown as ReturnType<typeof vi.fn>;
      const constructorArgs = s3Constructor.mock.calls[s3Constructor.mock.calls.length - 1][0];
      expect(constructorArgs.credentials.sessionToken).toBe('FwoGZXIvYXdzE...');
    });
  });
});
