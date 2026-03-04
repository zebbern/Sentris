import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthConfig } from '../config/auth.config';

export interface OrgMember {
  userId: string;
  displayName: string;
  email: string | null;
  role: string;
  avatarUrl: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  members: OrgMember[];
  expiresAt: number;
}

@Injectable()
export class OrgMembersService {
  private readonly logger = new Logger(OrgMembersService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly clerkSecretKey: string | null;

  constructor(private readonly configService: ConfigService) {
    const authConfig = this.configService.get<AuthConfig>('auth');
    this.clerkSecretKey = authConfig?.clerk?.secretKey ?? null;
  }

  async listMembers(organizationId: string): Promise<OrgMember[]> {
    // Check cache
    const cached = this.cache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.members;
    }

    if (!this.clerkSecretKey) {
      this.logger.warn('Clerk secret key not configured, cannot list org members');
      return [];
    }

    try {
      const members = await this.fetchMembersFromClerk(organizationId);
      this.cache.set(organizationId, {
        members,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return members;
    } catch (error) {
      this.logger.error(`Failed to fetch org members for ${organizationId}: ${error}`);
      // Return stale cache if available
      if (cached) return cached.members;
      return [];
    }
  }

  private async fetchMembersFromClerk(organizationId: string): Promise<OrgMember[]> {
    const members: OrgMember[] = [];
    let offset = 0;
    const limit = 100;

    // Paginate through Clerk API
    while (true) {
      const url = `https://api.clerk.com/v1/organizations/${organizationId}/memberships?limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.clerkSecretKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Clerk API returned ${response.status}: ${body}`);
      }

      const data = (await response.json()) as {
        data: {
          public_user_data: {
            user_id: string;
            first_name: string | null;
            last_name: string | null;
            identifier: string | null;
            image_url: string | null;
          };
          role: string;
        }[];
        total_count: number;
      };

      for (const membership of data.data) {
        const userData = membership.public_user_data;
        const firstName = userData.first_name ?? '';
        const lastName = userData.last_name ?? '';
        const displayName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

        members.push({
          userId: userData.user_id,
          displayName,
          email: userData.identifier,
          role: membership.role?.toUpperCase() ?? 'MEMBER',
          avatarUrl: userData.image_url,
        });
      }

      if (members.length >= data.total_count || data.data.length < limit) {
        break;
      }
      offset += limit;
    }

    return members;
  }
}
