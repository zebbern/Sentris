import { describe, it, expect, vi } from 'bun:test';
import { TerminalArchiveService } from '../terminal-archive.service';

const chunks = [
  {
    chunkIndex: 1,
    payload: Buffer.from('hello').toString('base64'),
    recordedAt: '2025-01-01T00:00:00Z',
    deltaMs: 0,
    stream: 'pty',
  },
];

describe('TerminalArchiveService', () => {
  const terminalStream = {
    fetchChunks: vi.fn().mockResolvedValue({ chunks }),
    listStreams: vi.fn().mockResolvedValue([]),
    deleteStreams: vi.fn().mockResolvedValue(0),
  } as any;
  const filesService = {
    uploadFile: vi.fn().mockResolvedValue({
      id: 'file-1',
      fileName: 'a.cast',
      mimeType: 'application/x-asciinema',
      size: 10,
    }),
    downloadFile: vi.fn(),
  } as any;
  const repo = {
    create: vi.fn().mockResolvedValue({
      id: 1,
      runId: 'run-1',
      nodeRef: 'node',
      stream: 'pty',
      fileId: 'file-1',
      chunkCount: 1,
      durationMs: 0,
      createdAt: new Date(),
    }),
    listByRun: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
  } as any;
  const workflowsService = {
    resolveRunForAccess: vi.fn().mockResolvedValue({
      run: { workflowId: 'wf-1', workflowVersionId: 'ver-1' },
      organizationId: 'org-1',
    }),
    resolveRunWithoutAuth: vi.fn().mockResolvedValue({
      run: { workflowId: 'wf-1', workflowVersionId: 'ver-1' },
      organizationId: 'org-1',
    }),
  } as any;

  it('archives terminal chunks and stores metadata', async () => {
    const service = new TerminalArchiveService(
      terminalStream,
      filesService,
      repo,
      workflowsService,
      {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    const record = await service.archive(null, 'run-1', { nodeRef: 'node' } as any);

    expect(terminalStream.fetchChunks).toHaveBeenCalledWith('run-1', {
      nodeRef: 'node',
      stream: 'pty',
    });
    expect(filesService.uploadFile).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(record.runId).toBe('run-1');
  });

  it('replays archived cast data', async () => {
    const castContent = [
      '{"version":2,"width":80,"height":24}',
      '[0.0,"o","Hello "]',
      '[0.5,"o","World"]',
    ].join('\n');
    repo.listByRun.mockResolvedValueOnce([
      {
        id: 10,
        runId: 'run-1',
        nodeRef: 'node',
        stream: 'pty',
        fileId: 'file-1',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        firstChunkIndex: 1,
      },
    ]);
    filesService.downloadFile.mockResolvedValueOnce({ buffer: Buffer.from(castContent) });

    const service = new TerminalArchiveService(
      terminalStream,
      filesService,
      repo,
      workflowsService,
      {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    const result = await service.replay({ organizationId: 'org-1' } as any, 'run-1', {
      nodeRef: 'node',
      stream: 'pty',
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.cursor).toContain('archive');
    expect(result.chunks[0].payload).toBe(Buffer.from('Hello ').toString('base64'));
  });

  it('treats lock contention as retryable instead of reporting a successful archive', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const service = new TerminalArchiveService(
      terminalStream,
      filesService,
      repo,
      workflowsService,
      {
        tryAcquire: vi.fn().mockResolvedValue(false),
        release,
      } as any,
    );

    await expect(service.archiveRun(null, 'run-1')).rejects.toThrow(
      'Terminal archive already in progress for run run-1',
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps Redis streams and retries only missing archives after a partial failure', async () => {
    const records: any[] = [];
    let stderrAttempts = 0;
    const fetchChunks = vi.fn(async (_runId: string, input: { stream: string }) => {
      if (input.stream === 'stderr' && stderrAttempts++ === 0) {
        throw new Error('object storage temporarily unavailable');
      }
      return { chunks };
    });
    const deleteStreams = vi.fn().mockResolvedValue(2);
    const create = vi.fn(async (input: any) => {
      const record = { id: records.length + 1, ...input };
      records.push(record);
      return record;
    });
    const service = new TerminalArchiveService(
      {
        fetchChunks,
        listStreams: vi.fn().mockResolvedValue([
          { nodeRef: 'node-a', stream: 'stdout' },
          { nodeRef: 'node-b', stream: 'stderr' },
        ]),
        deleteStreams,
      } as any,
      {
        ...filesService,
        uploadFile: vi.fn(async (_auth: unknown, fileName: string) => ({
          id: `file-${fileName}`,
          fileName,
          mimeType: 'application/x-asciinema',
          size: 10,
        })),
      } as any,
      {
        create,
        listByRun: vi.fn(async () => [...records]),
      } as any,
      workflowsService,
      {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    await expect(service.archiveRun(null, 'run-1')).rejects.toThrow(
      'object storage temporarily unavailable',
    );
    expect(deleteStreams).not.toHaveBeenCalled();
    expect(records.map((record) => record.nodeRef)).toEqual(['node-a']);

    await expect(service.archiveRun(null, 'run-1')).resolves.toHaveLength(1);
    expect(deleteStreams).toHaveBeenCalledTimes(1);
    expect(fetchChunks.mock.calls.filter((call) => call[1]?.stream === 'stdout')).toHaveLength(1);
    expect(fetchChunks.mock.calls.filter((call) => call[1]?.stream === 'stderr')).toHaveLength(2);
  });

  it('propagates Redis deletion failure so the durable event retries cleanup', async () => {
    const service = new TerminalArchiveService(
      {
        fetchChunks: vi.fn().mockResolvedValue({ chunks }),
        listStreams: vi.fn().mockResolvedValue([{ nodeRef: 'node-a', stream: 'stdout' }]),
        deleteStreams: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
      } as any,
      filesService,
      {
        ...repo,
        listByRun: vi.fn().mockResolvedValue([]),
      } as any,
      workflowsService,
      {
        tryAcquire: vi.fn().mockResolvedValue(true),
        release: vi.fn().mockResolvedValue(undefined),
      } as any,
    );

    await expect(service.archiveRun(null, 'run-1')).rejects.toThrow('Redis unavailable');
  });
});
