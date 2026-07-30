import { Controller, Get, Logger, Post, Res, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { buildFindingOrganizationIndexKey } from '@sentris/shared/finding-observation-id';

import { CurrentAuth } from './auth/auth-context.decorator';
import type { AuthContext } from './auth/types';
import { Public } from './auth/public.decorator';
import type { AuthConfig } from './config/auth.config';
import type { AppConfig } from './config';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE,
  createSessionToken,
} from './auth/session.utils';
import { OpenSearchTenantService } from './analytics/opensearch-tenant.service';
import { ProvisioningLockService } from './common/redis/provisioning-lock.service';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readonly authCfg: AuthConfig;
  /** Track org provisioning state: resolved promises for completed orgs, pending promises for in-flight */
  private readonly provisioningOrgs = new Map<string, Promise<boolean>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly tenantService: OpenSearchTenantService,
    private readonly provisioningLock: ProvisioningLockService,
  ) {
    this.authCfg = this.configService.get<AuthConfig>('auth')!;
  }

  /**
   * Auth validation endpoint for nginx auth_request.
   * Returns 200 if authenticated, 401 otherwise.
   * Used by nginx to protect /analytics/* routes.
   *
   * Response headers (for nginx tenant isolation):
   * - X-Auth-Organization-Id: collision-safe OpenSearch organization key
   * - X-Auth-User-Id: user identifier
   *
   * Note: SkipThrottle is required because nginx sends an auth_request
   * for every resource loaded from /analytics/*, which can quickly
   * exceed rate limits and cause 500 errors.
   */
  @SkipThrottle()
  @Get('/auth/validate')
  validateAuth(@CurrentAuth() auth: AuthContext | null, @Res({ passthrough: true }) res: Response) {
    if (!auth || !auth.isAuthenticated || typeof auth.organizationId !== 'string') {
      throw new UnauthorizedException();
    }

    const organizationId = auth.organizationId;
    let organizationKey: string;
    try {
      organizationKey = buildFindingOrganizationIndexKey(organizationId);
    } catch {
      throw new UnauthorizedException();
    }
    res.setHeader('X-Auth-Organization-Id', organizationKey);
    res.setHeader('X-Auth-User-Id', auth.userId || '');

    // Ensure OpenSearch tenant exists for this org (fire-and-forget, cached)
    // Three-layer dedup:
    //   1. Local Map — same-instance Promise dedup (avoids Redis round-trip on every request)
    //   2. Redis "done" marker — cross-instance completion check
    //   3. Redis SETNX lock — cross-instance in-flight dedup
    if (!this.provisioningOrgs.has(organizationKey)) {
      this.tryProvisionOrg(organizationId, organizationKey);
    }

    return { valid: true };
  }

  /**
   * Attempt to provision an org's OpenSearch tenant with distributed locking.
   * Fire-and-forget — errors never block auth validation.
   */
  private tryProvisionOrg(orgId: string, organizationKey: string): void {
    const promise = this.doProvisionOrg(orgId, organizationKey).then(
      (success) => {
        if (!success) {
          // Provisioning returned false or was skipped — allow retry
          this.provisioningOrgs.delete(organizationKey);
        }
        return success;
      },
      (err) => {
        this.provisioningOrgs.delete(organizationKey);
        this.logger.error(`Failed to provision OpenSearch tenant for ${orgId}: ${err}`);
        return false;
      },
    );
    this.provisioningOrgs.set(organizationKey, promise);
  }

  /**
   * Core provisioning logic with Redis-backed distributed lock.
   * Returns true if provisioning succeeded or was already done.
   */
  private async doProvisionOrg(orgId: string, organizationKey: string): Promise<boolean> {
    // Check Redis completion marker — avoids provisioning call if another instance already succeeded
    const alreadyDone = await this.provisioningLock.isProvisioned(organizationKey);
    if (alreadyDone) return true;

    // Acquire distributed lock — returns false if another instance is already provisioning
    const acquired = await this.provisioningLock.tryAcquire(organizationKey);
    if (!acquired) return true; // Another instance is handling it — treat as success

    try {
      const success = await this.tenantService.ensureTenantExists(orgId);
      if (success) {
        await this.provisioningLock.markProvisioned(organizationKey);
      }
      return success;
    } finally {
      await this.provisioningLock.release(organizationKey);
    }
  }

  /**
   * Login endpoint for local auth.
   * Validates Basic auth credentials and sets a session cookie.
   */
  @Public()
  @Post('/auth/login')
  login(
    @Headers('authorization') authHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Only for local auth provider
    if (this.authCfg.provider !== 'local') {
      throw new UnauthorizedException('Login endpoint only available for local auth');
    }

    // Validate Basic auth header
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing Basic Auth credentials');
    }

    const base64Credentials = authHeader.slice(6);
    let username: string;
    let password: string;

    try {
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      [username, password] = credentials.split(':');
    } catch {
      throw new UnauthorizedException('Invalid Basic Auth format');
    }

    if (!username || !password) {
      throw new UnauthorizedException('Invalid Basic Auth format');
    }

    // Validate credentials
    if (
      username !== this.authCfg.local.adminUsername ||
      password !== this.authCfg.local.adminPassword
    ) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    // Create session token and set cookie
    const sessionToken = createSessionToken(username, {
      sessionSecret: this.configService.get<AuthConfig>('auth')?.sessionSecret,
      nodeEnv: this.configService.get<AppConfig>('app')?.nodeEnv,
    });

    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: this.configService.get<AppConfig>('app')!.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: SESSION_COOKIE_MAX_AGE,
      path: '/',
    });

    return { success: true, message: 'Logged in successfully' };
  }

  /**
   * Logout endpoint for local auth.
   * Clears the session cookie.
   */
  @Public()
  @Post('/auth/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { success: true, message: 'Logged out successfully' };
  }
}
