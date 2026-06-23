import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';

import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

// ── Mock helpers ────────────────────────────────────────────────────
function makeMockRequest(overrides: Record<string, unknown> = {}) {
  return { method: 'GET', url: '/api/test', ...overrides };
}

function makeMockResponse(overrides: Record<string, unknown> = {}) {
  const res: Record<string, unknown> = {
    headersSent: false,
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
    ...overrides,
  };
  // Allow chaining: status(n).json(body)
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function makeMockHost(request: unknown, response: unknown) {
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
      getResponse: vi.fn().mockReturnValue(response),
    }),
  };
}

function makeMockConfigService(isProduction: boolean) {
  return {
    get: vi.fn().mockReturnValue({
      nodeEnv: isProduction ? 'production' : 'development',
    }),
  };
}

function createFilter(isProduction = false) {
  const configService = makeMockConfigService(isProduction);
  return new AllExceptionsFilter(configService as any);
}

// ── Tests ───────────────────────────────────────────────────────────
describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress logger output during tests
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  // ── HttpException with string response ──────────────────────────
  describe('HttpException with string response', () => {
    it('returns the original status code', () => {
      const filter = createFilter();
      const request = makeMockRequest();
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, host as any);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('produces JSON with statusCode, message, error, timestamp, and path', () => {
      const filter = createFilter();
      const request = makeMockRequest({ url: '/api/users/42' });
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      filter.catch(exception, host as any);

      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.statusCode).toBe(404);
      expect(body.message).toBe('Not found');
      expect(body.error).toBe('Not found');
      expect(body.path).toBe('/api/users/42');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  // ── HttpException with object response ──────────────────────────
  describe('HttpException with object response', () => {
    it('merges timestamp and path into the response body', () => {
      const filter = createFilter();
      const request = makeMockRequest({ url: '/api/data' });
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new HttpException(
        { statusCode: 400, message: 'Validation failed', errors: ['field required'] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host as any);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.statusCode).toBe(400);
      expect(body.message).toBe('Validation failed');
      expect(body.errors).toEqual(['field required']);
      expect(body.path).toBe('/api/data');
      expect(typeof body.timestamp).toBe('string');
    });
  });

  // ── Unknown errors (production) ─────────────────────────────────
  describe('unknown errors in production mode', () => {
    it('returns 500 with generic message — no stack leak', () => {
      const filter = createFilter(true);
      const request = makeMockRequest();
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new Error('Database connection lost');

      filter.catch(exception, host as any);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('Internal server error');
      expect(body.error).toBe('Internal Server Error');
      expect(body.stack).toBeUndefined();
    });
  });

  // ── Unknown errors (development) ────────────────────────────────
  describe('unknown errors in development mode', () => {
    it('includes message and stack in response body', () => {
      const filter = createFilter(false);
      const request = makeMockRequest();
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new Error('Something broke');

      filter.catch(exception, host as any);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Something broke');
      expect(typeof body.stack).toBe('string');
    });

    it('does not include stack for non-Error objects', () => {
      const filter = createFilter(false);
      const request = makeMockRequest();
      const response = makeMockResponse();
      const host = makeMockHost(request, response);

      filter.catch('string error', host as any);

      const body = (response.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(body.message).toBe('Internal server error');
      expect(body.stack).toBeUndefined();
    });
  });

  // ── SSE / streaming (headersSent) ───────────────────────────────
  describe('SSE / streaming responses (headersSent)', () => {
    it('calls response.end() instead of sending JSON when headers are already sent', () => {
      const filter = createFilter();
      const request = makeMockRequest();
      const response = makeMockResponse({ headersSent: true });
      const host = makeMockHost(request, response);
      const exception = new Error('stream broken');

      filter.catch(exception, host as any);

      expect(response.end).toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    });
  });

  // ── Logging behavior ───────────────────────────────────────────
  describe('logging', () => {
    it('logs 5xx errors via logger.error', () => {
      const filter = createFilter();
      const request = makeMockRequest({ method: 'POST', url: '/api/crash' });
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new Error('Unexpected failure');
      const errorSpy = vi.spyOn(Logger.prototype, 'error');

      filter.catch(exception, host as any);

      expect(errorSpy).toHaveBeenCalled();
      const firstArg = errorSpy.mock.calls[0][0] as string;
      expect(firstArg).toContain('500');
      expect(firstArg).toContain('POST');
      expect(firstArg).toContain('/api/crash');
    });

    it('logs 4xx HttpExceptions via logger.warn', () => {
      const filter = createFilter();
      const request = makeMockRequest({ method: 'DELETE', url: '/api/items/1' });
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');

      filter.catch(exception, host as any);

      expect(warnSpy).toHaveBeenCalled();
      const firstArg = warnSpy.mock.calls[0][0] as string;
      expect(firstArg).toContain('403');
      expect(firstArg).toContain('DELETE');
      expect(firstArg).toContain('/api/items/1');
    });

    it('logs missing-auth auth validation probes below warn/error while preserving the 401', () => {
      const filter = createFilter();
      const request = makeMockRequest({ method: 'GET', url: '/api/v1/auth/validate' });
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const exception = new UnauthorizedException(
        'Missing authentication - provide session cookie or Basic Auth',
      );
      const errorSpy = vi.spyOn(Logger.prototype, 'error');
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      filter.catch(exception, host as any);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        '[401] GET /api/v1/auth/validate - Missing authentication - provide session cookie or Basic Auth',
      );
    });

    it('logs non-Error, non-HttpException unknown values via logger.error as 500', () => {
      const filter = createFilter();
      const request = makeMockRequest();
      const response = makeMockResponse();
      const host = makeMockHost(request, response);
      const errorSpy = vi.spyOn(Logger.prototype, 'error');

      filter.catch(42, host as any);

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
