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
    const mockDetail = {
      id: 'f-123',
      timestamp: '2025-01-01T00:00:00Z',
      raw: {},
      availability: 'available' as const,
    };
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
    const mockStats = {
      severityCounts: [{ severity: 'high', count: 5 }],
      total: 5,
      availability: 'available' as const,
      schemaCoverage: { canonical: 5, legacy: 0, invalid: 0 },
    };
    httpGetMock.mockResolvedValueOnce(mockStats);

    const result = await findingsApi.getStats();

    expect(httpGetMock).toHaveBeenCalledWith('/findings/stats');
    expect(result).toEqual(mockStats);
  });

  it('passes the target scope filter to stats', async () => {
    httpGetMock.mockResolvedValueOnce({ severityCounts: [], total: 0 });

    await findingsApi.getStats({ scopeId: 'scope-123' });

    expect(httpGetMock).toHaveBeenCalledWith('/findings/stats?scopeId=scope-123');
  });

  it('passes projected triage filters to stats', async () => {
    httpGetMock.mockResolvedValueOnce({ severityCounts: [], total: 0 });

    await findingsApi.getStats({ triageStatus: 'fixed', assigneeUserId: 'user-123' });

    expect(httpGetMock).toHaveBeenCalledWith(
      '/findings/stats?triageStatus=fixed&assigneeUserId=user-123',
    );
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
      headers: new Headers({
        'X-Sentris-Availability': 'available',
        'X-Sentris-Schema-Canonical': '1',
        'X-Sentris-Schema-Legacy': '0',
        'X-Sentris-Schema-Invalid': '0',
      }),
    });

    const result = await findingsApi.exportFindings({ format: 'csv', severity: 'high' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/findings/export?'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('format=csv');
    expect(url).toContain('severity=high');
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.availability).toBe('available');
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
      headers: new Headers({
        'X-Sentris-Availability': 'available',
        'X-Sentris-Schema-Canonical': '1',
        'X-Sentris-Schema-Legacy': '0',
        'X-Sentris-Schema-Invalid': '0',
      }),
    });

    const result = await findingsApi.exportFindings({ format: 'json' });

    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('preserves availability, projection, schema, and raw response headers', async () => {
    const headers = new Headers({
      'X-Sentris-Availability': 'degraded',
      'X-Sentris-Degraded-Reasons': 'triage_enrichment_unavailable,invalid_schema_documents',
      'X-Sentris-Projection-Health-Reason': 'projection_events_pending',
      'X-Sentris-Projection-Reconciled-Through': '2026-07-26T12:00:00.000Z',
      'X-Sentris-Schema-Canonical': '8',
      'X-Sentris-Schema-Legacy': '2',
      'X-Sentris-Schema-Invalid': '1',
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(['{}'], { type: 'application/json' })),
      headers,
    });

    const result = await findingsApi.exportFindings({ format: 'json' });

    expect(result).toEqual(
      expect.objectContaining({
        availability: 'degraded',
        degradedReasons: ['triage_enrichment_unavailable', 'invalid_schema_documents'],
        projectionHealthReason: 'projection_events_pending',
        projectionReconciledThrough: '2026-07-26T12:00:00.000Z',
        schemaCoverage: { canonical: 8, legacy: 2, invalid: 1 },
        headers,
      }),
    );
  });

  it('passes the target scope filter to exports', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(['{}'], { type: 'application/json' })),
      headers: new Headers(),
    });

    await findingsApi.exportFindings({ format: 'json', scopeId: 'scope-123' });

    expect(fetchMock.mock.calls[0][0]).toContain('scopeId=scope-123');
  });

  it('passes projected triage filters to exports', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(['{}'], { type: 'application/json' })),
      headers: new Headers(),
    });

    await findingsApi.exportFindings({
      format: 'json',
      triageStatus: 'fixed',
      assigneeUserId: 'user-123',
    });

    expect(fetchMock.mock.calls[0][0]).toContain('triageStatus=fixed&assigneeUserId=user-123');
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

  it('forwards the opaque cursor without interpreting it', async () => {
    httpGetMock.mockResolvedValueOnce({
      items: [],
      total: 10_001,
      page: 2,
      pageSize: 25,
      paginationMode: 'cursor',
      nextCursor: null,
    });

    await findingsApi.list({
      page: 2,
      pageSize: 25,
      paginationMode: 'cursor',
      cursor: 'signed+/cursor==',
    });

    const path: string = httpGetMock.mock.calls[0][0];
    expect(path).toContain('paginationMode=cursor');
    expect(path).toContain('cursor=signed%2B%2Fcursor%3D%3D');
  });

  it('passes the target scope filter to the canonical findings query', async () => {
    httpGetMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 25 });

    await findingsApi.list({ scopeId: 'scope-123' });

    expect(httpGetMock).toHaveBeenCalledWith('/findings?scopeId=scope-123');
  });
});
