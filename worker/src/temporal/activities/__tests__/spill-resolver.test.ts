import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ApplicationFailure } from '@temporalio/common';
import { unspill, type InputWarning } from '../spill-resolver';
import type { IFileStorageService } from '@sentris/component-sdk';

function createSpilledMarker(storageRef: string, handle?: string) {
  return {
    __spilled__: true as const,
    storageRef,
    originalSize: 100,
    ...(handle ? { __spilled_handle__: handle } : {}),
  };
}

function createMockStorage(downloads: Record<string, unknown>): IFileStorageService {
  return {
    downloadFile: vi.fn(async (ref: string) => {
      const data = downloads[ref];
      if (data === undefined) {
        throw new Error(`File not found: ${ref}`);
      }
      return {
        buffer: Buffer.from(JSON.stringify(data), 'utf8'),
        metadata: { id: ref, fileName: 'spill.json', mimeType: 'application/json', size: 100 },
      };
    }),
    getFileMetadata: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as IFileStorageService;
}

describe('unspill', () => {
  let cache: Map<string, unknown>;
  let warnings: InputWarning[];

  beforeEach(() => {
    cache = new Map();
    warnings = [];
  });

  it('leaves non-spilled values untouched', async () => {
    const obj = { name: 'hello', count: 42, nested: { a: 1 } };
    const storage = createMockStorage({});

    await unspill(obj as Record<string, unknown>, 'Input', storage, cache, warnings);

    expect(obj.name).toBe('hello');
    expect(obj.count).toBe(42);
    expect(warnings).toHaveLength(0);
  });

  it('replaces spilled marker with __self__ handle with full downloaded data', async () => {
    const fullData = { result: 'big payload', items: [1, 2, 3] };
    const storage = createMockStorage({ 'ref-1': fullData });

    const obj: Record<string, unknown> = {
      data: createSpilledMarker('ref-1', '__self__'),
    };

    await unspill(obj, 'Input', storage, cache, warnings);

    expect(obj.data).toEqual(fullData);
    expect(warnings).toHaveLength(0);
  });

  it('replaces spilled marker with no handle with full downloaded data', async () => {
    const fullData = { everything: true };
    const storage = createMockStorage({ 'ref-2': fullData });

    const obj: Record<string, unknown> = {
      payload: createSpilledMarker('ref-2'),
    };

    await unspill(obj, 'Input', storage, cache, warnings);

    expect(obj.payload).toEqual(fullData);
  });

  it('extracts specific property when named handle is provided', async () => {
    const fullData = { output: 'resolved value', other: 'ignored' };
    const storage = createMockStorage({ 'ref-3': fullData });

    const obj: Record<string, unknown> = {
      myInput: { ...createSpilledMarker('ref-3'), __spilled_handle__: 'output' },
    };

    await unspill(obj, 'Input', storage, cache, warnings);

    expect(obj.myInput).toBe('resolved value');
    expect(warnings).toHaveLength(0);
  });

  it('sets value to undefined and pushes warning when handle not found in downloaded data', async () => {
    const fullData = { a: 1, b: 2 };
    const storage = createMockStorage({ 'ref-4': fullData });

    const obj: Record<string, unknown> = {
      missing: { ...createSpilledMarker('ref-4'), __spilled_handle__: 'nonexistent' },
    };

    await unspill(obj, 'Input', storage, cache, warnings);

    expect(obj.missing).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].target).toBe('missing');
    expect(warnings[0].sourceHandle).toBe('nonexistent');
    expect(warnings[0].sourceRef).toBe('spilled-storage');
  });

  it('uses download cache — same storageRef is only downloaded once', async () => {
    const fullData = { shared: 'value' };
    const storage = createMockStorage({ 'ref-5': fullData });

    const obj: Record<string, unknown> = {
      first: createSpilledMarker('ref-5', '__self__'),
      second: createSpilledMarker('ref-5', '__self__'),
    };

    await unspill(obj, 'Input', storage, cache, warnings);

    expect(obj.first).toEqual(fullData);
    expect(obj.second).toEqual(fullData);
    expect(storage.downloadFile).toHaveBeenCalledTimes(1);
  });

  it('logs warning and skips when storage service is undefined', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const obj: Record<string, unknown> = {
      spilled: createSpilledMarker('ref-6', '__self__'),
    };

    await unspill(obj, 'Input', undefined, cache, warnings);

    // Value should remain as the spill marker (skipped, not replaced)
    expect((obj.spilled as Record<string, unknown>).__spilled__).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('throws retryable ApplicationFailure on download failure', async () => {
    const storage = createMockStorage({}); // no data → downloadFile throws

    const obj: Record<string, unknown> = {
      broken: createSpilledMarker('missing-ref', '__self__'),
    };

    try {
      await unspill(obj, 'Input', storage, cache, warnings);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApplicationFailure);
      const af = thrown as ApplicationFailure;
      expect(af.type).toBe('SpillResolutionError');
      expect(af.nonRetryable).toBe(false);
      expect(af.message).toContain('broken');
    }
  });

  it('populates cache on first download for subsequent lookups', async () => {
    const fullData = { x: 99 };
    const storage = createMockStorage({ 'ref-7': fullData });

    const obj1: Record<string, unknown> = {
      a: createSpilledMarker('ref-7', '__self__'),
    };

    await unspill(obj1, 'Input', storage, cache, warnings);
    expect(cache.has('ref-7')).toBe(true);
    expect(cache.get('ref-7')).toEqual(fullData);

    // Second call should use cache
    const obj2: Record<string, unknown> = {
      b: createSpilledMarker('ref-7', '__self__'),
    };

    await unspill(obj2, 'Param', storage, cache, warnings);
    expect(storage.downloadFile).toHaveBeenCalledTimes(1);
    expect(obj2.b).toEqual(fullData);
  });
});
