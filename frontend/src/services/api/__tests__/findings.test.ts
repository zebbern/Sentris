import { describe, it, expect, afterEach, vi, mock, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const httpGetMock = vi.fn();
const fetchMock = vi.fn();

mock.module('@/services/api/client', () => ({
  httpGet: httpGetMock,
  getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  API_V1_URL: 'http://localhost:3211/api/v1',
}));

// Must import AFTER mock.module
import { findingsApi } from '../findings';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Mock global fetch for the exportFindings method (which uses fetch directly)
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// findingsApi.get(id)
// ---------------------------------------------------------------------------

describe('findingsApi.get', () => {
  it('calls httpGet with the correct endpoint path', async () => {
    const mockDetail = { id: 'f-123', timestamp: '2025-01-01T00:00:00Z', raw: {} };
    httpGetMock.mockResolvedValueOnce(mockDetail);

    const result = await findingsApi.get('f-123');

    expect(httpGetMock).toHaveBeenCalledWith('/findings/f-123');
    expect(result).toEqual(mockDetail);
  });
});

// ---------------------------------------------------------------------------
// findingsApi.getStats()
// ---------------------------------------------------------------------------

describe('findingsApi.getStats', () => {
  it('calls httpGet with /findings/stats', async () => {
    const mockStats = { severityCounts: [{ severity: 'high', count: 5 }], total: 5 };
    httpGetMock.mockResolvedValueOnce(mockStats);

    const result = await findingsApi.getStats();

    expect(httpGetMock).toHaveBeenCalledWith('/findings/stats');
    expect(result).toEqual(mockStats);
  });
});

// ---------------------------------------------------------------------------
// findingsApi.exportFindings()
// ---------------------------------------------------------------------------

describe('findingsApi.exportFindings', () => {
  it('calls fetch with correct URL and query params for CSV', async () => {
    const mockBlob = new Blob(['csv,data'], { type: 'text/csv' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    const result = await findingsApi.exportFindings({ format: 'csv', severity: 'high' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/findings/export?'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('format=csv');
    expect(url).toContain('severity=high');
    expect(result).toBeInstanceOf(Blob);
  });

  it('throws error when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Too many requests' }),
    });

    await expect(findingsApi.exportFindings({ format: 'json' })).rejects.toThrow(
      'Too many requests',
    );
  });

  it('returns a Blob on successful export', async () => {
    const mockBlob = new Blob(['{}'], { type: 'application/json' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    const result = await findingsApi.exportFindings({ format: 'json' });

    expect(result).toBeInstanceOf(Blob);
  });
});

// ---------------------------------------------------------------------------
// findingsApi.list()
// ---------------------------------------------------------------------------

describe('findingsApi.list', () => {
  it('calls httpGet with /findings path', async () => {
    httpGetMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 25 });

    await findingsApi.list();

    expect(httpGetMock).toHaveBeenCalledWith('/findings');
  });

  it('appends query parameters when provided', async () => {
    httpGetMock.mockResolvedValueOnce({ items: [], total: 0, page: 2, pageSize: 10 });

    await findingsApi.list({ page: 2, pageSize: 10, severity: 'critical' });

    const path: string = httpGetMock.mock.calls[0][0];
    expect(path).toContain('page=2');
    expect(path).toContain('pageSize=10');
    expect(path).toContain('severity=critical');
  });
});
