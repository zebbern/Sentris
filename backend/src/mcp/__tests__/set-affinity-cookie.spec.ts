import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { setAffinityCookie } from '../set-affinity-cookie';
import type { Request, Response } from 'express';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    protocol: 'http',
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response & { cookie: ReturnType<typeof jest.fn> } {
  return {
    cookie: jest.fn(),
  } as unknown as Response & { cookie: ReturnType<typeof jest.fn> };
}

describe('setAffinityCookie', () => {
  let res: ReturnType<typeof createMockRes>;

  beforeEach(() => {
    res = createMockRes();
  });

  it('sets cookie with correct name and value', () => {
    const req = createMockReq();
    setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

    expect(res.cookie).toHaveBeenCalledTimes(1);
    expect(res.cookie.mock.calls[0][0]).toBe('mcp_affinity');
    expect(res.cookie.mock.calls[0][1]).toBe('session-123');
  });

  it('sets httpOnly, sameSite strict, and path', () => {
    const req = createMockReq();
    setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

    const options = res.cookie.mock.calls[0][2];
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/api/v1/mcp');
  });

  it('sets maxAge to 2 hours in milliseconds', () => {
    const req = createMockReq();
    setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

    const options = res.cookie.mock.calls[0][2];
    expect(options.maxAge).toBe(7200 * 1000);
  });

  it('scopes cookie to the provided path', () => {
    const req = createMockReq();
    setAffinityCookie(req, res, 'session-456', '/api/v1/studio-mcp');

    const options = res.cookie.mock.calls[0][2];
    expect(options.path).toBe('/api/v1/studio-mcp');
  });

  describe('secure flag', () => {
    it('sets secure=true when x-forwarded-proto is https', () => {
      const req = createMockReq({
        headers: { 'x-forwarded-proto': 'https' },
      });
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

      const options = res.cookie.mock.calls[0][2];
      expect(options.secure).toBe(true);
    });

    it('sets secure=true when protocol is https', () => {
      const req = createMockReq({ protocol: 'https' } as Partial<Request>);
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

      const options = res.cookie.mock.calls[0][2];
      expect(options.secure).toBe(true);
    });

    it('does not set secure flag on plain HTTP', () => {
      const req = createMockReq({ protocol: 'http' } as Partial<Request>);
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

      const options = res.cookie.mock.calls[0][2];
      expect(options.secure).toBeUndefined();
    });

    it('does not set secure flag when x-forwarded-proto is http', () => {
      const req = createMockReq({
        headers: { 'x-forwarded-proto': 'http' },
        protocol: 'http',
      } as Partial<Request>);
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

      const options = res.cookie.mock.calls[0][2];
      expect(options.secure).toBeUndefined();
    });
  });

  describe('idempotent behavior', () => {
    it('can be called multiple times with same value without error', () => {
      const req = createMockReq();
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');
      setAffinityCookie(req, res, 'session-123', '/api/v1/mcp');

      expect(res.cookie).toHaveBeenCalledTimes(2);
      // Both calls produce identical cookie options
      expect(res.cookie.mock.calls[0]).toEqual(res.cookie.mock.calls[1]);
    });

    it('overwrites cookie when called with different value', () => {
      const req = createMockReq();
      setAffinityCookie(req, res, 'session-old', '/api/v1/mcp');
      setAffinityCookie(req, res, 'session-new', '/api/v1/mcp');

      expect(res.cookie.mock.calls[0][1]).toBe('session-old');
      expect(res.cookie.mock.calls[1][1]).toBe('session-new');
    });
  });

  describe('path isolation', () => {
    it('uses different paths for gateway vs studio-mcp', () => {
      const req = createMockReq();
      setAffinityCookie(req, res, 'val', '/api/v1/mcp');
      setAffinityCookie(req, res, 'val', '/api/v1/studio-mcp');

      expect(res.cookie.mock.calls[0][2].path).toBe('/api/v1/mcp');
      expect(res.cookie.mock.calls[1][2].path).toBe('/api/v1/studio-mcp');
    });
  });
});
