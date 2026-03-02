import { beforeEach, describe, expect, it, jest } from 'bun:test';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AnalyticsController } from '../analytics.controller';
import type { SecurityAnalyticsService } from '../security-analytics.service';
import type { OrganizationSettingsService } from '../organization-settings.service';
import type { OpenSearchTenantService } from '../opensearch-tenant.service';
import type { ConfigService } from '@nestjs/config';
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

const AUTH_MEMBER: AuthContext = {
  userId: 'user-2',
  organizationId: 'org-123',
  roles: ['MEMBER'],
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

const INTERNAL_TOKEN = 'test-internal-token-abc123';

const NOW = new Date('2025-06-15T12:00:00Z');

function makeOrgSettings(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org-123',
    subscriptionTier: 'pro' as const,
    analyticsRetentionDays: 30,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSecurityAnalyticsService() {
  return {
    query: jest.fn().mockResolvedValue({ total: 0, hits: [] }),
  } as unknown as SecurityAnalyticsService;
}

function makeOrganizationSettingsService() {
  return {
    getOrganizationSettings: jest.fn().mockResolvedValue(makeOrgSettings()),
    updateOrganizationSettings: jest.fn().mockResolvedValue(makeOrgSettings()),
    getMaxRetentionDays: jest.fn().mockReturnValue(90),
    validateRetentionPeriod: jest.fn().mockReturnValue(true),
  } as unknown as OrganizationSettingsService;
}

function makeOpenSearchTenantService() {
  return {
    isSecurityEnabled: jest.fn().mockReturnValue(true),
    ensureTenantExists: jest.fn().mockResolvedValue(true),
  } as unknown as OpenSearchTenantService;
}

function makeConfigService(token: string = INTERNAL_TOKEN) {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'INTERNAL_SERVICE_TOKEN') return token;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function makeAuditLogService() {
  return {
    record: jest.fn(),
  } as unknown as AuditLogService;
}

function createController(
  overrides: {
    configToken?: string;
    securityAnalytics?: SecurityAnalyticsService;
    orgSettings?: OrganizationSettingsService;
    tenantService?: OpenSearchTenantService;
    auditLog?: AuditLogService;
  } = {},
) {
  const securityAnalytics = overrides.securityAnalytics ?? makeSecurityAnalyticsService();
  const orgSettings = overrides.orgSettings ?? makeOrganizationSettingsService();
  const tenantService = overrides.tenantService ?? makeOpenSearchTenantService();
  const configService = makeConfigService(overrides.configToken ?? INTERNAL_TOKEN);
  const auditLog = overrides.auditLog ?? makeAuditLogService();

  const controller = new AnalyticsController(
    securityAnalytics,
    orgSettings,
    tenantService,
    configService,
    auditLog,
  );

  return { controller, securityAnalytics, orgSettings, tenantService, configService, auditLog };
}

// ===========================================================================
// POST /query
// ===========================================================================

describe('AnalyticsController', () => {
  describe('POST /query (queryAnalytics)', () => {
    let controller: AnalyticsController;
    let securityAnalytics: SecurityAnalyticsService;
    let auditLog: AuditLogService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      securityAnalytics = ctx.securityAnalytics;
      auditLog = ctx.auditLog;
    });

    it('returns query results for authenticated user with organization context', async () => {
      const mockResult = { total: 5, hits: [{ _id: '1', _source: { severity: 'high' } }] };
      (securityAnalytics.query as ReturnType<typeof jest.fn>).mockResolvedValue(mockResult);

      const result = await controller.queryAnalytics(AUTH_ADMIN, { query: { match_all: {} } });

      expect(result).toEqual(mockResult);
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.queryAnalytics(null, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth is not authenticated', async () => {
      await expect(controller.queryAnalytics(AUTH_UNAUTHENTICATED, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth has no organizationId', async () => {
      await expect(controller.queryAnalytics(AUTH_NO_ORG, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('applies default size: 10 and from: 0 when not provided', async () => {
      await controller.queryAnalytics(AUTH_ADMIN, {});

      expect(securityAnalytics.query).toHaveBeenCalledWith('org-123', {
        query: undefined,
        size: 10,
        from: 0,
        aggs: undefined,
      });
    });

    it('passes provided size/from/query/aggs through to the service', async () => {
      const query = { match: { severity: 'high' } };
      const aggs = { bySeverity: { terms: { field: 'severity' } } };

      await controller.queryAnalytics(AUTH_ADMIN, { query, size: 50, from: 100, aggs });

      expect(securityAnalytics.query).toHaveBeenCalledWith('org-123', {
        query,
        size: 50,
        from: 100,
        aggs,
      });
    });

    it('records an audit log entry via auditLogService.record', async () => {
      await controller.queryAnalytics(AUTH_ADMIN, { query: { match_all: {} }, size: 25, from: 5 });

      expect(auditLog.record).toHaveBeenCalledWith(AUTH_ADMIN, {
        action: 'analytics.query',
        resourceType: 'analytics',
        resourceId: null,
        resourceName: null,
        metadata: {
          size: 25,
          from: 5,
          hasQuery: true,
          hasAggs: false,
        },
      });
    });
  });

  // =========================================================================
  // GET /settings
  // =========================================================================

  describe('GET /settings (getAnalyticsSettings)', () => {
    let controller: AnalyticsController;
    let orgSettings: OrganizationSettingsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      orgSettings = ctx.orgSettings;
    });

    it('returns settings for authenticated user with organization context', async () => {
      const result = await controller.getAnalyticsSettings(AUTH_ADMIN);

      expect(result.organizationId).toBe('org-123');
      expect(result.subscriptionTier).toBe('pro');
      expect(result.analyticsRetentionDays).toBe(30);
      expect(result.maxRetentionDays).toBe(90);
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(controller.getAnalyticsSettings(null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth is unauthenticated', async () => {
      await expect(controller.getAnalyticsSettings(AUTH_UNAUTHENTICATED)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when auth has no organizationId', async () => {
      await expect(controller.getAnalyticsSettings(AUTH_NO_ORG)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('includes maxRetentionDays from getMaxRetentionDays', async () => {
      (orgSettings.getMaxRetentionDays as ReturnType<typeof jest.fn>).mockReturnValue(365);

      const result = await controller.getAnalyticsSettings(AUTH_ADMIN);

      expect(result.maxRetentionDays).toBe(365);
      expect(orgSettings.getMaxRetentionDays).toHaveBeenCalledWith('pro');
    });

    it('formats dates as ISO strings', async () => {
      const result = await controller.getAnalyticsSettings(AUTH_ADMIN);

      expect(result.createdAt).toBe('2025-06-15T12:00:00.000Z');
      expect(result.updatedAt).toBe('2025-06-15T12:00:00.000Z');
    });
  });

  // =========================================================================
  // PUT /settings
  // =========================================================================

  describe('PUT /settings (updateAnalyticsSettings)', () => {
    let controller: AnalyticsController;
    let orgSettings: OrganizationSettingsService;

    beforeEach(() => {
      const ctx = createController();
      controller = ctx.controller;
      orgSettings = ctx.orgSettings;
    });

    it('updates settings for authenticated ADMIN user', async () => {
      const updatedSettings = makeOrgSettings({ analyticsRetentionDays: 60 });
      (orgSettings.updateOrganizationSettings as ReturnType<typeof jest.fn>).mockResolvedValue(
        updatedSettings,
      );

      const result = await controller.updateAnalyticsSettings(AUTH_ADMIN, {
        analyticsRetentionDays: 60,
      });

      expect(result.analyticsRetentionDays).toBe(60);
      expect(orgSettings.updateOrganizationSettings).toHaveBeenCalledWith('org-123', {
        analyticsRetentionDays: 60,
        subscriptionTier: undefined,
      });
    });

    it('throws UnauthorizedException when auth is null', async () => {
      await expect(
        controller.updateAnalyticsSettings(null, { analyticsRetentionDays: 30 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when auth is unauthenticated', async () => {
      await expect(
        controller.updateAnalyticsSettings(AUTH_UNAUTHENTICATED, { analyticsRetentionDays: 30 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when auth has no organizationId', async () => {
      await expect(
        controller.updateAnalyticsSettings(AUTH_NO_ORG, { analyticsRetentionDays: 30 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws ForbiddenException when user does not have ADMIN role', async () => {
      await expect(
        controller.updateAnalyticsSettings(AUTH_MEMBER, { analyticsRetentionDays: 30 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws BadRequestException when analyticsRetentionDays exceeds tier limit', async () => {
      (orgSettings.validateRetentionPeriod as ReturnType<typeof jest.fn>).mockReturnValue(false);

      await expect(
        controller.updateAnalyticsSettings(AUTH_ADMIN, { analyticsRetentionDays: 999 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses new subscriptionTier for validation when provided in update', async () => {
      (orgSettings.validateRetentionPeriod as ReturnType<typeof jest.fn>).mockReturnValue(true);
      (orgSettings.updateOrganizationSettings as ReturnType<typeof jest.fn>).mockResolvedValue(
        makeOrgSettings({ subscriptionTier: 'enterprise' }),
      );

      await controller.updateAnalyticsSettings(AUTH_ADMIN, {
        analyticsRetentionDays: 200,
        subscriptionTier: 'enterprise',
      });

      // Should validate against the new tier ('enterprise'), not the current ('pro')
      expect(orgSettings.validateRetentionPeriod).toHaveBeenCalledWith('enterprise', 200);
    });

    it('falls back to current tier for validation when subscriptionTier is not in update', async () => {
      (orgSettings.validateRetentionPeriod as ReturnType<typeof jest.fn>).mockReturnValue(true);

      await controller.updateAnalyticsSettings(AUTH_ADMIN, {
        analyticsRetentionDays: 60,
      });

      // Should validate against the current tier ('pro') from getOrganizationSettings
      expect(orgSettings.validateRetentionPeriod).toHaveBeenCalledWith('pro', 60);
    });
  });

  // =========================================================================
  // POST /ensure-tenant
  // =========================================================================

  describe('POST /ensure-tenant (ensureTenant)', () => {
    it('provisions tenant successfully with valid internal token and security enabled', async () => {
      const { controller } = createController();

      const result = await controller.ensureTenant(INTERNAL_TOKEN, {
        organizationId: 'org-456',
      });

      expect(result).toEqual({
        success: true,
        securityEnabled: true,
        message: 'Tenant provisioned for org-456',
      });
    });

    it('throws UnauthorizedException when INTERNAL_SERVICE_TOKEN is not configured (empty)', async () => {
      const { controller } = createController({ configToken: '' });

      await expect(
        controller.ensureTenant(INTERNAL_TOKEN, { organizationId: 'org-456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when x-internal-token header is missing', async () => {
      const { controller } = createController();

      await expect(
        controller.ensureTenant(undefined, { organizationId: 'org-456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException when x-internal-token does not match', async () => {
      const { controller } = createController();

      await expect(
        controller.ensureTenant('wrong-token', { organizationId: 'org-456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns securityEnabled: false when security mode is disabled', async () => {
      const tenantService = makeOpenSearchTenantService();
      (tenantService.isSecurityEnabled as ReturnType<typeof jest.fn>).mockReturnValue(false);
      const { controller } = createController({ tenantService });

      const result = await controller.ensureTenant(INTERNAL_TOKEN, {
        organizationId: 'org-456',
      });

      expect(result.securityEnabled).toBe(false);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Security mode disabled');
    });

    it('returns success: false with message when tenant provisioning fails', async () => {
      const tenantService = makeOpenSearchTenantService();
      (tenantService.ensureTenantExists as ReturnType<typeof jest.fn>).mockResolvedValue(false);
      const { controller } = createController({ tenantService });

      const result = await controller.ensureTenant(INTERNAL_TOKEN, {
        organizationId: 'org-789',
      });

      expect(result.success).toBe(false);
      expect(result.securityEnabled).toBe(true);
      expect(result.message).toContain('Failed to provision tenant for org-789');
    });
  });
});
