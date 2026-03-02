import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { LoggingInterceptor } from '../interceptors/logging.interceptor';

// ── Mock helpers ────────────────────────────────────────────────────
function makeMockRequest(overrides: Record<string, unknown> = {}) {
  return { method: 'GET', url: '/api/data', ...overrides };
}

function makeMockResponse(overrides: Record<string, unknown> = {}) {
  return { statusCode: 200, ...overrides };
}

function makeMockExecutionContext(type: string, request: unknown, response: unknown) {
  return {
    getType: vi.fn().mockReturnValue(type),
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
      getResponse: vi.fn().mockReturnValue(response),
    }),
  };
}

function makeMockCallHandler(result: unknown = 'response-data') {
  return {
    handle: vi.fn().mockReturnValue(of(result)),
  };
}

function makeMockCallHandlerWithError(error: Error) {
  return {
    handle: vi.fn().mockReturnValue(throwError(() => error)),
  };
}

// ── Tests ───────────────────────────────────────────────────────────
describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    interceptor = new LoggingInterceptor();
  });

  describe('successful HTTP requests', () => {
    it('logs method, url, statusCode, and duration via logger.log', () => {
      const request = makeMockRequest({ method: 'POST', url: '/api/items' });
      const response = makeMockResponse({ statusCode: 201 });
      const context = makeMockExecutionContext('http', request, response);
      const handler = makeMockCallHandler();
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      return new Promise<void>((resolve) => {
        interceptor.intercept(context as any, handler as any).subscribe({
          complete: () => {
            expect(logSpy).toHaveBeenCalled();
            const message = logSpy.mock.calls[0][0] as string;
            expect(message).toContain('POST');
            expect(message).toContain('/api/items');
            expect(message).toContain('201');
            expect(message).toMatch(/\d+ms/);
            resolve();
          },
        });
      });
    });
  });

  describe('failed HTTP requests', () => {
    it('logs HttpException status via logger.warn', () => {
      const request = makeMockRequest({ method: 'GET', url: '/api/secret' });
      const response = makeMockResponse();
      const context = makeMockExecutionContext('http', request, response);
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      const handler = makeMockCallHandlerWithError(exception);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');

      return new Promise<void>((resolve) => {
        interceptor.intercept(context as any, handler as any).subscribe({
          error: () => {
            expect(warnSpy).toHaveBeenCalled();
            const message = warnSpy.mock.calls[0][0] as string;
            expect(message).toContain('GET');
            expect(message).toContain('/api/secret');
            expect(message).toContain('403');
            expect(message).toMatch(/\d+ms/);
            resolve();
          },
        });
      });
    });

    it('logs status 500 for non-HttpException errors', () => {
      const request = makeMockRequest({ method: 'PUT', url: '/api/thing' });
      const response = makeMockResponse();
      const context = makeMockExecutionContext('http', request, response);
      const handler = makeMockCallHandlerWithError(new Error('unexpected'));
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');

      return new Promise<void>((resolve) => {
        interceptor.intercept(context as any, handler as any).subscribe({
          error: () => {
            expect(warnSpy).toHaveBeenCalled();
            const message = warnSpy.mock.calls[0][0] as string;
            expect(message).toContain('PUT');
            expect(message).toContain('/api/thing');
            expect(message).toContain('500');
            resolve();
          },
        });
      });
    });
  });

  describe('non-HTTP context', () => {
    it('passes through without logging', () => {
      const context = makeMockExecutionContext('rpc', {}, {});
      const handler = makeMockCallHandler('rpc-result');
      const logSpy = vi.spyOn(Logger.prototype, 'log');
      const warnSpy = vi.spyOn(Logger.prototype, 'warn');

      return new Promise<void>((resolve) => {
        interceptor.intercept(context as any, handler as any).subscribe({
          next: (value) => {
            expect(value).toBe('rpc-result');
          },
          complete: () => {
            expect(logSpy).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
            resolve();
          },
        });
      });
    });

    it('uses ws context type without logging', () => {
      const context = makeMockExecutionContext('ws', {}, {});
      const handler = makeMockCallHandler();
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      return new Promise<void>((resolve) => {
        interceptor.intercept(context as any, handler as any).subscribe({
          complete: () => {
            expect(logSpy).not.toHaveBeenCalled();
            resolve();
          },
        });
      });
    });
  });
});
