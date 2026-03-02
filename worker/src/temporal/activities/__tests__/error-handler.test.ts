import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { ApplicationFailure } from '@temporalio/common';
import { ValidationError } from '@sentris/component-sdk';
import { handleComponentError } from '../error-handler';

function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    actionRef: 'node-1',
    componentId: 'test-component',
    activityId: 'act-1',
    attempt: 1,
    runId: 'run-1',
    streamId: 'stream-1',
    joinStrategy: undefined,
    triggeredBy: undefined,
    failure: undefined,
    trace: {
      record: vi.fn(),
    },
    nodeIO: {
      recordStart: vi.fn().mockResolvedValue(undefined),
      recordCompletion: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as Parameters<typeof handleComponentError>[1];
}

describe('handleComponentError', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('throws non-retryable ApplicationFailure for a plain Error', async () => {
    const error = new Error('something broke');

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApplicationFailure);
      const af = thrown as ApplicationFailure;
      expect(af.message).toBe('something broke');
      expect(af.type).toBe('Error');
      expect(af.nonRetryable).toBe(true);
    }
  });

  it('throws retryable ApplicationFailure when error has retryable: true', async () => {
    const error = new Error('transient') as Error & { retryable: boolean };
    error.retryable = true;

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApplicationFailure);
      const af = thrown as ApplicationFailure;
      expect(af.nonRetryable).toBe(false);
    }
  });

  it('uses error.type as the ApplicationFailure type when present', async () => {
    const error = new Error('bad config') as Error & { type: string };
    error.type = 'ConfigurationError';

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      const af = thrown as ApplicationFailure;
      expect(af.type).toBe('ConfigurationError');
    }
  });

  it('extracts fieldErrors from a ValidationError into the trace event', async () => {
    const error = new ValidationError('Bad input', {
      fieldErrors: { email: ['required'] },
    });

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch {
      // expected
    }

    const traceCall = (ctx.trace!.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(traceCall.error.fieldErrors).toEqual({ email: ['required'] });
    expect(traceCall.error.type).toBe('ValidationError');
  });

  it('includes truncated details in the trace error when error has details', async () => {
    const error = new Error('oops') as Error & { details: Record<string, unknown> };
    error.details = { foo: 'bar', count: 42 };

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch {
      // expected
    }

    const traceCall = (ctx.trace!.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(traceCall.error.details).toBeDefined();
    expect(traceCall.error.details.foo).toBe('bar');
  });

  it('calls trace.record with NODE_FAILED event containing the error message', async () => {
    const error = new Error('trace me');

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch {
      // expected
    }

    expect(ctx.trace!.record).toHaveBeenCalledTimes(1);
    const traceCall = (ctx.trace!.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(traceCall.type).toBe('NODE_FAILED');
    expect(traceCall.message).toBe('trace me');
    expect(traceCall.level).toBe('error');
  });

  it('calls nodeIO.recordCompletion with status failed', async () => {
    const error = new Error('io fail');

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch {
      // expected
    }

    expect(ctx.nodeIO!.recordCompletion).toHaveBeenCalledTimes(1);
    const ioCall = (ctx.nodeIO!.recordCompletion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ioCall.status).toBe('failed');
    expect(ioCall.errorMessage).toBe('io fail');
    expect(ioCall.nodeRef).toBe('node-1');
    expect(ioCall.runId).toBe('run-1');
  });

  it('handles a non-Error thrown value gracefully', async () => {
    try {
      await handleComponentError('raw string error', ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApplicationFailure);
      const af = thrown as ApplicationFailure;
      expect(af.type).toBe('ComponentError');
      expect(af.nonRetryable).toBe(true);
    }
  });

  it('works when trace and nodeIO are undefined', async () => {
    ctx = createMockContext({ trace: undefined, nodeIO: undefined });
    const error = new Error('no services');

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ApplicationFailure);
    }
  });

  it('includes context details in the ApplicationFailure details array', async () => {
    ctx = createMockContext({
      streamId: 'stream-42',
      joinStrategy: 'all',
      triggeredBy: 'trigger-node',
    });
    const error = new Error('detail check');

    try {
      await handleComponentError(error, ctx);
      expect.unreachable('should have thrown');
    } catch (thrown) {
      const af = thrown as ApplicationFailure;
      // ApplicationFailure wraps each detail in an extra array
      const details = (af.details?.[0] as unknown[])?.[0] as Record<string, unknown>;
      expect(details.streamId).toBe('stream-42');
      expect(details.joinStrategy).toBe('all');
      expect(details.triggeredBy).toBe('trigger-node');
      expect(details.componentId).toBe('test-component');
      expect(details.nodeRef).toBe('node-1');
    }
  });
});
