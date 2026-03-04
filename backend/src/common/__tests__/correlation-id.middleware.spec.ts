import { beforeEach, describe, expect, it, vi } from 'bun:test';

import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';

function makeMockRequest(headers: Record<string, string | undefined> = {}) {
  return { headers: { ...headers } } as unknown as import('express').Request;
}

function makeMockResponse() {
  const res = {
    setHeader: vi.fn(),
  } as unknown as import('express').Response;
  return res;
}

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = new CorrelationIdMiddleware();
  });

  it('generates a UUID when X-Request-Id header is absent', () => {
    const req = makeMockRequest();
    const res = makeMockResponse();
    const next = vi.fn();

    middleware.use(req, res, next);

    const correlationId = (req as unknown as Record<string, unknown>)['correlationId'] as string;
    expect(correlationId).toBeDefined();
    // UUID v4 format
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('reuses the X-Request-Id header when present', () => {
    const req = makeMockRequest({ 'x-request-id': 'incoming-id-123' });
    const res = makeMockResponse();
    const next = vi.fn();

    middleware.use(req, res, next);

    const correlationId = (req as unknown as Record<string, unknown>)['correlationId'] as string;
    expect(correlationId).toBe('incoming-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'incoming-id-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates a UUID when X-Request-Id header is empty string', () => {
    const req = makeMockRequest({ 'x-request-id': '' });
    const res = makeMockResponse();
    const next = vi.fn();

    middleware.use(req, res, next);

    const correlationId = (req as unknown as Record<string, unknown>)['correlationId'] as string;
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(next).toHaveBeenCalled();
  });

  it('sets the response header', () => {
    const req = makeMockRequest({ 'x-request-id': 'test-id' });
    const res = makeMockResponse();
    const next = vi.fn();

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'test-id');
  });
});
