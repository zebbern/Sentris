import { describe, it, expect } from 'bun:test';
import { humanizeApiError } from '../humanizeApiError';

describe('humanizeApiError', () => {
  describe('network errors', () => {
    it('returns network message for TypeError', () => {
      expect(humanizeApiError(new TypeError('Failed to fetch'))).toBe(
        'Unable to connect — check your network',
      );
    });
  });

  describe('HTTP status codes', () => {
    it('returns session expired for 401', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401 });
      expect(humanizeApiError(error)).toBe('Session expired — please sign in again');
    });

    it('returns permission denied for 403', () => {
      const error = Object.assign(new Error('Forbidden'), { status: 403 });
      expect(humanizeApiError(error)).toBe('Permission denied');
    });

    it('returns conflict message for 409', () => {
      const error = Object.assign(new Error('Conflict'), { status: 409 });
      expect(humanizeApiError(error)).toBe('Conflict — another change was made');
    });

    it('returns validation error for 422', () => {
      const error = Object.assign(new Error('Unprocessable'), { status: 422 });
      expect(humanizeApiError(error)).toBe('Validation error');
    });

    it('returns service unavailable for 502', () => {
      const error = Object.assign(new Error('Bad Gateway'), { status: 502 });
      expect(humanizeApiError(error)).toBe('Service temporarily unavailable');
    });

    it('returns service unavailable for 503', () => {
      const error = Object.assign(new Error('Service Unavailable'), { status: 503 });
      expect(humanizeApiError(error)).toBe('Service temporarily unavailable');
    });

    it('returns service unavailable for 504', () => {
      const error = Object.assign(new Error('Gateway Timeout'), { status: 504 });
      expect(humanizeApiError(error)).toBe('Service temporarily unavailable');
    });
  });

  describe('axios-style errors with response.status', () => {
    it('extracts status from response object', () => {
      const error = Object.assign(new Error('Request failed'), {
        response: { status: 403 },
      });
      expect(humanizeApiError(error)).toBe('Permission denied');
    });
  });

  describe('status codes in error message', () => {
    it('extracts 409 from error message string', () => {
      const error = new Error('Request failed with status 409');
      expect(humanizeApiError(error)).toBe('Conflict — another change was made');
    });
  });

  describe('Error instances with messages', () => {
    it('returns the error message for standard Error', () => {
      expect(humanizeApiError(new Error('Something specific broke'))).toBe(
        'Something specific broke',
      );
    });

    it('strips HTML from error message', () => {
      const error = new Error('<html><body>502 Bad Gateway</body></html>');
      expect(humanizeApiError(error)).toBe('Service temporarily unavailable');
    });

    it('returns fallback for Error with empty message after stripping HTML tags', () => {
      const error = new Error('<div></div>');
      expect(humanizeApiError(error)).toBe('Something went wrong — please try again');
    });
  });

  describe('non-Error values', () => {
    it('returns fallback for null', () => {
      expect(humanizeApiError(null)).toBe('Something went wrong — please try again');
    });

    it('returns fallback for undefined', () => {
      expect(humanizeApiError(undefined)).toBe('Something went wrong — please try again');
    });

    it('returns fallback for a plain string', () => {
      expect(humanizeApiError('oops')).toBe('Something went wrong — please try again');
    });

    it('returns fallback for a number', () => {
      expect(humanizeApiError(42)).toBe('Something went wrong — please try again');
    });

    it('returns fallback for a plain object without status', () => {
      expect(humanizeApiError({ foo: 'bar' })).toBe('Something went wrong — please try again');
    });
  });

  describe('plain object with numeric status (non-Error)', () => {
    it('maps status 401 from plain object', () => {
      expect(humanizeApiError({ status: 401 })).toBe('Session expired — please sign in again');
    });
  });
});
