import { beforeEach, describe, expect, it, jest } from 'bun:test';
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { FindingsController } from '../findings.controller';
import type { SecurityAnalyticsService } from '../security-analytics.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { AuthContext } from '../../auth/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTH_ADMIN: AuthContext = {
  userId: 'user-1',
  organizationId: 'org-123',
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_NO_ORG: AuthContext = {
  userId: 'user-1',
  organizationId: null,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'test',
};

const AUTH_UNAUTHENTICATED: AuthContext = {
  userId: null,
  organizationId: null,
  roles: [],
  isAuthenticated: false,
  provider: 'test',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSecurityAnalyticsService(overrides: Partial<SecurityAnalyticsService> = {}) {
  return {
    query: jest.fn().mockResolvedValue({ total: 0, hits: [], aggregations: {} }),
    isAvailable: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as SecurityAnalyticsService;
}

function makeAuditLogService(): AuditLogService {
  return { record: jest.fn() } as unknown as AuditLogService;
}

function createController(
  overrides: {
    securityAnalytics?: SecurityAnalyticsService;
    auditLog?: AuditLogService;
  } = {},
) {
  const securityAnalytics = overrides.securityAnalytics ?? makeSecurityAnalyticsService();
  const auditLog = overrides.auditLog ?? makeAuditLogService();
  const controller = new FindingsController(securityAnalytics, auditLog);
  return { controller, securityAnalytics, auditLog };
}

// ---------------------------------------------------------------------------
// Shared response helpers
// ---------------------------------------------------------------------------

function makeHit(id: string, source: Record<string, unknown> = {}) {
  return {
    _id: id,
    _source: {
      '@timestamp': '2025-06-15T12:00:00.000Z',
      severity: 'high',
      name: 'SQL Injection',
      asset_key: 'example.com',
      workflow_name: 'Web Scan',
      workflow_id: 'wf-1',
      run_id: 'run-1',
      component_id: 'comp-1',
      node_ref: 'node-1',
      ...source,
    },
  };
}

// ===========================================================================
// GET /findings/stats
// ===========================================================================

describe('FindingsController', () => {
  describe('GET /findings/stats', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
    });

    it('returns severity counts from OpenSearch aggregation buckets', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 55,
        hits: [],
        aggregations: {
          severity_counts: {
            buckets: [
              { key: 'high', doc_count: 42 },
              { key: 'critical', doc_count: 13 },
            ],
          },
        },
      });

      const result = await controller.getStats(AUTH_ADMIN, {} as any);

      expect(result.severityCounts).toEqual([
        { severity: 'high', count: 42 },
        { severity: 'critical', count: 13 },
      ]);
      expect(result.total).toBe(55);
    });

    it('returns empty counts when OpenSearch query fails (graceful degradation)', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await controller.getStats(AUTH_ADMIN, {} as any);

      expect(result.severityCounts).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      await expect(controller.getStats(AUTH_UNAUTHENTICATED, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when no organization context', async () => {
      await expect(controller.getStats(AUTH_NO_ORG, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.getStats(null, {} as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // GET /findings/export
  // =========================================================================

  describe('GET /findings/export', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
    });

    function makeMockResponse() {
      const headers: Record<string, string> = {};
      const res = {
        set: jest.fn().mockImplementation(function (this: any, key: string, value: string) {
          headers[key] = value;
          return this;
        }),
        send: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        _headers: headers,
      };
      return res as any;
    }

    it('returns JSON with correct Content-Type and Content-Disposition when format=json', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 100 } as any, res);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.set).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('findings-export-'),
      );
      expect(res.json).toHaveBeenCalled();
    });

    it('returns CSV with correct Content-Type when format=csv', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(res.send).toHaveBeenCalled();
    });

    it('CSV output contains expected columns', async () => {
      const hit = makeHit('f-1');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      const csvOutput: string = res.send.mock.calls[0][0];
      const headerLine = csvOutput.split('\r\n')[0];
      const expectedColumns = [
        'id',
        'timestamp',
        'severity',
        'name',
        'asset_key',
        'workflow_name',
        'workflow_id',
        'run_id',
        'component_id',
        'node_ref',
      ];
      expect(headerLine).toBe(expectedColumns.join(','));
    });

    it('CSV properly escapes values containing commas and quotes', async () => {
      const hit = makeHit('f-1', { name: 'Vuln with, comma', asset_key: 'host "quoted"' });
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'csv', limit: 100 } as any, res);

      const csvOutput: string = res.send.mock.calls[0][0];
      const dataLine = csvOutput.split('\r\n')[1];
      // Commas should be wrapped in double quotes
      expect(dataLine).toContain('"Vuln with, comma"');
      // Inner double quotes should be escaped to double-double quotes
      expect(dataLine).toContain('"host ""quoted"""');
    });

    it('applies severity filter to the OpenSearch query', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      const res = makeMockResponse();
      await controller.exportFindings(
        AUTH_ADMIN,
        { format: 'json', limit: 100, severity: 'critical' } as any,
        res,
      );

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.query).toEqual({
        bool: { must: [{ term: { severity: 'critical' } }] },
      });
    });

    it('respects the limit parameter', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      const res = makeMockResponse();
      await controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 42 } as any, res);

      const queryArg = (securityAnalytics.query as ReturnType<typeof jest.fn>).mock.calls[0][1];
      expect(queryArg.size).toBe(42);
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      const res = makeMockResponse();
      await expect(
        controller.exportFindings(AUTH_UNAUTHENTICATED, { format: 'json' } as any, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws InternalServerErrorException when OpenSearch fails', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockRejectedValue(
        new Error('Connection lost'),
      );

      const res = makeMockResponse();
      await expect(
        controller.exportFindings(AUTH_ADMIN, { format: 'json', limit: 100 } as any, res),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  // =========================================================================
  // GET /findings/:id
  // =========================================================================

  describe('GET /findings/:id', () => {
    let controller: FindingsController;
    let securityAnalytics: SecurityAnalyticsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
    });

    it('returns full finding detail when document exists', async () => {
      const hit = makeHit('finding-42');
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const result = await controller.getFinding(AUTH_ADMIN, { id: 'finding-42' });

      expect(result.id).toBe('finding-42');
      expect(result.severity).toBe('high');
      expect(result.name).toBe('SQL Injection');
    });

    it('includes raw field with complete _source data', async () => {
      const sourceData = {
        '@timestamp': '2025-06-15T12:00:00.000Z',
        severity: 'high',
        custom: 'data',
      };
      const hit = { _id: 'f-1', _source: sourceData };
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 1,
        hits: [hit],
      });

      const result = await controller.getFinding(AUTH_ADMIN, { id: 'f-1' });

      expect(result.raw).toEqual(sourceData);
    });

    it('throws NotFoundException when no hits returned', async () => {
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue({
        total: 0,
        hits: [],
      });

      await expect(controller.getFinding(AUTH_ADMIN, { id: 'nonexistent' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ServiceUnavailableException when OpenSearch is disabled', async () => {
      const svc = makeSecurityAnalyticsService();
      (svc.isAvailable as ReturnType<typeof jest.fn>).mockReturnValue(false);
      const { controller: ctrl } = createController({ securityAnalytics: svc });

      await expect(ctrl.getFinding(AUTH_ADMIN, { id: 'any-id' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('throws UnauthorizedException when unauthenticated', async () => {
      await expect(
        controller.getFinding(AUTH_UNAUTHENTICATED, { id: 'any-id' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.getFinding(null, { id: 'any-id' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
