import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';

import { McpRegistryRepository } from './mcp-registry.repository';
import { parseServerYaml } from './registry-yaml-parser';
import { FEATURED_SERVERS } from './registry-featured';
import {
  GITHUB_API_BASE,
  DEFAULT_REGISTRY_REPO,
  RAW_CONTENT_BASE,
  SYNC_BATCH_SIZE,
  RATE_LIMIT_THRESHOLD,
  GITHUB_REQUEST_TIMEOUT_MS,
  MAX_YAML_SIZE_BYTES,
} from './registry-featured';
import { MCP_REGISTRY_REDIS } from './mcp-registry.constants';
import type { RegistrySyncResult } from '@sentris/shared';

interface GitHubTreeResponse {
  sha: string;
  tree: { path: string; type: string; sha: string }[];
}

interface GitHubCompareResponse {
  files?: { filename: string; status: string }[];
}

@Injectable()
export class McpRegistrySyncService {
  private readonly logger = new Logger(McpRegistrySyncService.name);
  private readonly repo: string;
  private readonly token: string | undefined;
  private syncing = false;

  private static readonly SYNC_LOCK_KEY = 'mcp-registry:sync-lock';
  private static readonly SYNC_LOCK_TTL_SECONDS = 600;

  constructor(
    private readonly repository: McpRegistryRepository,
    private readonly configService: ConfigService,
    @Optional() @Inject(MCP_REGISTRY_REDIS) private readonly redis: Redis | null,
  ) {
    this.repo = this.configService.get<string>('MCP_REGISTRY_REPO') ?? DEFAULT_REGISTRY_REPO;
    this.token = this.configService.get<string>('GITHUB_REGISTRY_TOKEN');
  }

  /**
   * Daily cron at 3 AM UTC. Can be disabled via MCP_REGISTRY_SYNC_ENABLED=false.
   */
  @Cron('0 3 * * *')
  async handleCron(): Promise<void> {
    const enabled = this.configService.get<string>('MCP_REGISTRY_SYNC_ENABLED');
    if (enabled === 'false') {
      this.logger.debug('Registry sync is disabled via MCP_REGISTRY_SYNC_ENABLED=false');
      return;
    }
    await this.triggerSync();
  }

  /**
   * Main sync entry point — can be called by cron or manually via API.
   * Uses a distributed Redis lock to prevent concurrent syncs across instances.
   */
  async triggerSync(): Promise<RegistrySyncResult> {
    // Acquire distributed lock via Redis (preferred) or fall back to local mutex
    if (this.redis) {
      const acquired = await this.redis.set(
        McpRegistrySyncService.SYNC_LOCK_KEY,
        '1',
        'EX',
        McpRegistrySyncService.SYNC_LOCK_TTL_SECONDS,
        'NX',
      );
      if (!acquired) {
        return {
          status: 'skipped',
          serversAdded: 0,
          serversUpdated: 0,
          serversRemoved: 0,
          totalServers: 0,
          durationMs: 0,
          error: 'Sync already in progress on another instance',
        };
      }
    } else if (this.syncing) {
      return {
        status: 'skipped',
        serversAdded: 0,
        serversUpdated: 0,
        serversRemoved: 0,
        totalServers: 0,
        durationMs: 0,
        error: 'Sync already in progress',
      };
    }

    this.syncing = true;
    const startTime = Date.now();

    try {
      await this.repository.updateSyncState({
        lastSyncStatus: 'syncing',
      });

      const result = await this.performSync();

      await this.repository.updateSyncState({
        lastSyncAt: new Date(),
        lastSyncStatus: result.status,
        serversSynced: result.totalServers,
        serversAdded: result.serversAdded,
        serversRemoved: result.serversRemoved,
        serversUpdated: result.serversUpdated,
        lastError: result.error,
      });

      this.logger.log(
        `Sync complete: +${result.serversAdded} ~${result.serversUpdated} -${result.serversRemoved} (${result.durationMs}ms)`,
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Sync failed: ${message}`);

      await this.repository.updateSyncState({
        lastSyncAt: new Date(),
        lastSyncStatus: 'failed',
        lastError: message,
      });

      return {
        status: 'failed',
        serversAdded: 0,
        serversUpdated: 0,
        serversRemoved: 0,
        totalServers: 0,
        durationMs: Date.now() - startTime,
        error: message,
      };
    } finally {
      this.syncing = false;
      if (this.redis) {
        await this.redis.del(McpRegistrySyncService.SYNC_LOCK_KEY).catch(() => {});
      }
    }
  }

  private async performSync(): Promise<RegistrySyncResult> {
    const startTime = Date.now();

    // 1. Fetch current tree SHA
    const treeResponse = await this.fetchGitHubTree();
    const currentTreeSha = treeResponse.sha;

    // 2. Get stored sync state
    const syncState = await this.repository.getSyncState();
    const lastTreeSha = syncState?.lastTreeSha;
    const lastCommitSha = syncState?.lastCommitSha;

    // 3. Check if tree is unchanged
    if (lastTreeSha && lastTreeSha === currentTreeSha) {
      return {
        status: 'skipped',
        serversAdded: 0,
        serversUpdated: 0,
        serversRemoved: 0,
        totalServers: syncState?.serversSynced ?? 0,
        durationMs: Date.now() - startTime,
        error: null,
      };
    }

    // 4. Find server.yaml files in tree
    const serverYamlPaths = treeResponse.tree
      .filter((item) => item.type === 'blob' && /^servers\/[^/]+\/server\.yaml$/.test(item.path))
      .map((item) => item.path);

    // 5. Determine which files need fetching
    let pathsToFetch: string[];
    let isIncremental = false;

    if (lastCommitSha) {
      try {
        const changedFiles = await this.fetchChangedFiles(lastCommitSha, currentTreeSha);
        const changedServerPaths = changedFiles.filter((f) =>
          /^servers\/[^/]+\/server\.yaml$/.test(f),
        );

        if (changedServerPaths.length > 0) {
          pathsToFetch = changedServerPaths;
          isIncremental = true;
          this.logger.log(`Incremental sync: ${changedServerPaths.length} changed files`);
        } else {
          // No server.yaml files changed — just handle deletions
          pathsToFetch = [];
          isIncremental = true;
        }
      } catch {
        this.logger.warn('Compare API failed — falling back to full sync');
        pathsToFetch = serverYamlPaths;
      }
    } else {
      this.logger.log(`Full sync: ${serverYamlPaths.length} server.yaml files`);
      pathsToFetch = serverYamlPaths;
    }

    // 6. Fetch and parse YAML files in batches
    let serversAdded = 0;
    let serversUpdated = 0;
    let hasPartialFailure = false;
    const existingNames = await this.repository.getAllCatalogNames();
    const existingNameSet = new Set(existingNames);
    const processedNames = new Set<string>();

    for (let i = 0; i < pathsToFetch.length; i += SYNC_BATCH_SIZE) {
      const batch = pathsToFetch.slice(i, i + SYNC_BATCH_SIZE);

      // Check rate limit before batch
      await this.checkRateLimit();

      const results = await Promise.allSettled(
        batch.map(async (path) => {
          const name = this.extractServerName(path);
          const yamlContent = await this.fetchRawFile(path);
          return { name, yamlContent };
        }),
      );

      const entries = [];
      for (const result of results) {
        if (result.status === 'rejected') {
          hasPartialFailure = true;
          this.logger.warn(`Failed to fetch YAML: ${result.reason}`);
          continue;
        }

        const { name, yamlContent } = result.value;
        const parsed = parseServerYaml(name, yamlContent);
        if (!parsed) {
          hasPartialFailure = true;
          continue;
        }

        parsed.registryCommitSha = currentTreeSha;
        entries.push(parsed);
        processedNames.add(name);

        if (existingNameSet.has(name)) {
          serversUpdated++;
        } else {
          serversAdded++;
        }
      }

      if (entries.length > 0) {
        await this.repository.upsertCatalogEntries(entries);
      }
    }

    // 7. Handle deletions (only on full sync)
    let serversRemoved = 0;
    if (!isIncremental) {
      const registryNames = new Set(serverYamlPaths.map((p) => this.extractServerName(p)));
      const namesToDelete = existingNames.filter((name) => !registryNames.has(name));

      if (namesToDelete.length > 0) {
        serversRemoved = await this.repository.deleteCatalogEntries(namesToDelete);
        this.logger.log(`Removed ${serversRemoved} servers no longer in registry`);
      }
    }

    // 8. Apply featured badges
    await this.repository.applyFeaturedBadges(FEATURED_SERVERS);

    // 9. Update sync state with new SHA
    await this.repository.updateSyncState({
      lastTreeSha: currentTreeSha,
      lastCommitSha: currentTreeSha,
    });

    const totalServers = existingNames.length + serversAdded - serversRemoved;

    return {
      status: hasPartialFailure ? 'partial' : 'success',
      serversAdded,
      serversUpdated,
      serversRemoved,
      totalServers,
      durationMs: Date.now() - startTime,
      error: null,
    };
  }

  // --- GitHub API helpers ---

  private async fetchGitHubTree(): Promise<GitHubTreeResponse> {
    const url = `${GITHUB_API_BASE}/repos/${this.repo}/git/trees/main?recursive=1`;
    const response = await this.githubFetch(url);

    if (!response.ok) {
      throw new Error(`GitHub tree API returned ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as GitHubTreeResponse;
  }

  private async fetchChangedFiles(baseSha: string, headSha: string): Promise<string[]> {
    const url = `${GITHUB_API_BASE}/repos/${this.repo}/compare/${baseSha}...${headSha}`;
    const response = await this.githubFetch(url);

    if (!response.ok) {
      throw new Error(`GitHub compare API returned ${response.status}`);
    }

    const data = (await response.json()) as GitHubCompareResponse;
    return (data.files ?? []).filter((f) => f.status !== 'removed').map((f) => f.filename);
  }

  private async fetchRawFile(path: string): Promise<string> {
    const url = `${RAW_CONTENT_BASE}/${this.repo}/main/${path}`;
    const response = await this.githubFetch(url);

    if (!response.ok) {
      throw new Error(`Raw file fetch failed for ${path}: ${response.status}`);
    }

    // Reject unexpectedly large files before reading body
    const contentLength = response.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > MAX_YAML_SIZE_BYTES) {
      throw new Error(
        `File too large for ${path}: ${contentLength} bytes (max ${MAX_YAML_SIZE_BYTES})`,
      );
    }

    return response.text();
  }

  private async githubFetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Sentris-Flow-MCP-Registry-Sync/1.0',
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return fetch(url, {
      headers,
      signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
    });
  }

  private lastRateLimitRemaining: number | null = null;
  private rateLimitResetAt: number | null = null;

  private async checkRateLimit(): Promise<void> {
    if (
      this.lastRateLimitRemaining !== null &&
      this.lastRateLimitRemaining < RATE_LIMIT_THRESHOLD &&
      this.rateLimitResetAt
    ) {
      const waitMs = this.rateLimitResetAt * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 600_000) {
        this.logger.warn(
          `Rate limit low (${this.lastRateLimitRemaining}), waiting ${Math.ceil(waitMs / 1000)}s`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // Probe rate limit status
    const url = `${GITHUB_API_BASE}/rate_limit`;
    try {
      const response = await this.githubFetch(url);
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      if (remaining) this.lastRateLimitRemaining = parseInt(remaining, 10);
      if (reset) this.rateLimitResetAt = parseInt(reset, 10);
    } catch {
      // Non-critical — continue even if rate limit check fails
    }
  }

  private extractServerName(path: string): string {
    // path format: servers/{name}/server.yaml
    const parts = path.split('/');
    return parts[1];
  }
}
