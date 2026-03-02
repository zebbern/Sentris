import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { McpRegistryRepository } from './mcp-registry.repository';
import { McpRegistrySyncService } from './mcp-registry-sync.service';
import { McpServersService } from '../mcp-servers/mcp-servers.service';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import type {
  RegistryCatalogQuery,
  RegistryCatalogEntry,
  RegistryCatalogDetail,
  RegistryCatalogListResponse,
  RegistryImportRequest,
  RegistryImportResponse,
  RegistrySyncStatus,
  RegistrySyncResult,
} from '@sentris/shared';
import type { RegistryCatalogRecord } from '../database/schema';

@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);

  private static readonly DENIED_MOUNT_PREFIXES = [
    '/etc',
    '/root',
    '/var/run',
    '/proc',
    '/sys',
    '/dev',
  ];

  constructor(
    private readonly repository: McpRegistryRepository,
    private readonly syncService: McpRegistrySyncService,
    private readonly mcpServersService: McpServersService,
  ) {}

  /**
   * Browse/search the registry catalog with pagination.
   */
  async getCatalog(
    auth: AuthContext | null,
    query: RegistryCatalogQuery,
  ): Promise<RegistryCatalogListResponse> {
    const organizationId = requireOrganizationId(auth);
    const result = await this.repository.findCatalogEntries(query);

    // Check which servers are already imported for this org
    const importedNames = await this.getImportedRegistryNames(organizationId);

    const data: RegistryCatalogEntry[] = result.data.map((record) =>
      this.mapToEntry(record, importedNames),
    );

    return {
      data,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
      },
      categories: result.categories,
    };
  }

  /**
   * Get detailed info for a single catalog entry.
   */
  async getCatalogEntry(auth: AuthContext | null, name: string): Promise<RegistryCatalogDetail> {
    const organizationId = requireOrganizationId(auth);
    const record = await this.repository.findCatalogEntryByName(name);

    if (!record) {
      throw new NotFoundException(`Registry server '${name}' not found`);
    }

    const importedNames = await this.getImportedRegistryNames(organizationId);
    return this.mapToDetail(record, importedNames);
  }

  /**
   * Import a registry server into the org's MCP Library.
   */
  async importServer(
    auth: AuthContext | null,
    dto: RegistryImportRequest,
  ): Promise<RegistryImportResponse> {
    const organizationId = requireOrganizationId(auth);

    // 1. Look up catalog entry
    const entry = await this.repository.findCatalogEntryByName(dto.registryName);
    if (!entry) {
      throw new NotFoundException(`Registry server '${dto.registryName}' not found`);
    }

    // 2. Check for duplicate import
    const existingServer = await this.mcpServersService.findByRegistrySource(
      dto.registryName,
      organizationId,
    );
    if (existingServer) {
      throw new ConflictException(
        `Server '${dto.registryName}' is already imported for this organization`,
      );
    }

    // 3. Validate required secrets
    const requiredSecrets = entry.configSchema?.secrets ?? [];
    const missingSecrets = requiredSecrets.filter((s) => !dto.secrets[s.env]);
    if (missingSecrets.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Missing required secrets',
        missingFields: missingSecrets.map((s) => s.env),
      });
    }

    // 4. Build create server DTO based on server type
    let transportType: 'http' | 'stdio';
    let endpoint: string | undefined;
    let command: string | undefined;
    let args: string[] | undefined;
    let headers: Record<string, string> | undefined;

    if (entry.serverType === 'remote' && entry.remoteConfig) {
      // Remote server → HTTP transport
      transportType = 'http';
      endpoint = entry.remoteConfig.url;

      // Merge any remote headers with user-provided secrets as headers
      const allHeaders: Record<string, string> = {};
      if (entry.remoteConfig.headers) {
        for (const [key, value] of Object.entries(entry.remoteConfig.headers)) {
          // Replace placeholder values with user-provided secrets
          allHeaders[key] = this.resolveSecretPlaceholders(value, dto.secrets);
        }
      }
      // Add secrets as Authorization headers if applicable
      for (const secret of requiredSecrets) {
        if (dto.secrets[secret.env]) {
          allHeaders[secret.env] = dto.secrets[secret.env];
        }
      }
      if (Object.keys(allHeaders).length > 0) {
        headers = allHeaders;
      }
    } else {
      // Docker/stdio server
      transportType = 'stdio';
      command = 'docker';
      args = ['run', '-i', '--rm'];

      // Store secrets in encrypted headers with env: prefix (not as plaintext args)
      const envHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(dto.secrets)) {
        envHeaders[`env:${key}`] = value;
      }
      if (Object.keys(envHeaders).length > 0) {
        headers = envHeaders;
      }

      // Add non-secret environment variables as args
      for (const [key, value] of Object.entries(dto.envVars)) {
        args.push('-e', `${key}=${value}`);
      }

      // Add env vars from config schema defaults
      const configEnv = entry.configSchema?.env ?? [];
      for (const envVar of configEnv) {
        if (envVar.value && !dto.envVars[envVar.name]) {
          args.push('-e', `${envVar.name}=${envVar.value}`);
        }
      }

      // Validate and add volumes from run config
      if (entry.runConfig?.volumes) {
        for (const volume of entry.runConfig.volumes) {
          const hostPath = volume.split(':')[0];
          if (
            McpRegistryService.DENIED_MOUNT_PREFIXES.some((prefix) => hostPath.startsWith(prefix))
          ) {
            throw new UnprocessableEntityException(`Unsafe volume mount rejected: ${hostPath}`);
          }
          args.push('-v', volume);
        }
      }

      // Add the Docker image
      if (entry.dockerImage) {
        args.push(entry.dockerImage);
      }

      // Add run command if specified
      if (entry.runConfig?.command) {
        args.push(...entry.runConfig.command);
      }
    }

    // 5. Create via McpServersService
    const serverResponse = await this.mcpServersService.createServer(auth, {
      name: entry.displayName,
      description: entry.description ?? undefined,
      transportType,
      endpoint,
      command,
      args,
      headers,
      enabled: dto.enabled,
      groupId: dto.groupId,
    });

    // 6. Set registry_source_name on the created server
    await this.mcpServersService.setRegistrySourceName(serverResponse.id, dto.registryName);

    this.logger.log(
      `Imported registry server '${dto.registryName}' as '${serverResponse.name}' (${serverResponse.id})`,
    );

    return {
      serverId: serverResponse.id,
      serverName: serverResponse.name,
      transportType: serverResponse.transportType,
      status: 'imported',
    };
  }

  /**
   * Get the current sync status.
   */
  async getSyncStatus(): Promise<RegistrySyncStatus> {
    const state = await this.repository.getSyncState();

    return {
      lastSyncAt: state?.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: state?.lastSyncStatus ?? null,
      serversSynced: state?.serversSynced ?? 0,
      serversAdded: state?.serversAdded ?? 0,
      serversRemoved: state?.serversRemoved ?? 0,
      serversUpdated: state?.serversUpdated ?? 0,
      lastError: state?.lastError ?? null,
    };
  }

  /**
   * Trigger a manual sync.
   */
  async triggerSync(): Promise<RegistrySyncResult> {
    return this.syncService.triggerSync();
  }

  // --- Private helpers ---

  private async getImportedRegistryNames(organizationId: string): Promise<Set<string>> {
    const names = await this.mcpServersService.listRegistrySourceNames(organizationId);
    return new Set(names);
  }

  private mapToEntry(
    record: RegistryCatalogRecord,
    importedNames: Set<string>,
  ): RegistryCatalogEntry {
    return {
      name: record.name,
      displayName: record.displayName,
      description: record.description,
      serverType: record.serverType as 'server' | 'remote',
      category: record.category,
      tags: (record.tags as string[]) ?? [],
      iconUrl: record.iconUrl,
      sourceUrl: record.sourceUrl,
      isFeatured: record.isFeatured,
      hasSecrets: (record.configSchema?.secrets?.length ?? 0) > 0,
      hasOAuth: (record.oauthConfig?.length ?? 0) > 0,
      isImported: importedNames.has(record.name),
    };
  }

  private mapToDetail(
    record: RegistryCatalogRecord,
    importedNames: Set<string>,
  ): RegistryCatalogDetail {
    return {
      ...this.mapToEntry(record, importedNames),
      dockerImage: record.dockerImage,
      remoteConfig: record.remoteConfig,
      configRequirements: {
        secrets: record.configSchema?.secrets ?? [],
        env: record.configSchema?.env ?? [],
      },
      oauthProviders: record.oauthConfig ?? [],
      runConfig: record.runConfig,
    };
  }

  private resolveSecretPlaceholders(value: string, secrets: Record<string, string>): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => secrets[key] ?? `\${${key}}`);
  }
}
