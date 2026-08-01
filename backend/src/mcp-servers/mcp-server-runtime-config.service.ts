import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  McpResolvedRuntimeDefinitionSchema,
  McpRuntimeKeySchema,
  resolveSentrisTrustProfile,
  type McpResolvedRuntimeDefinition,
  type McpRuntimeKey,
} from '@sentris/shared';

import type { AuthContext } from '../auth/types';
import type { McpServerRecord } from '../database/schema';
import { sha256 } from '../mcp-runtime/mcp-binding-fingerprint';
import { SecretResolver } from '../secrets/secret-resolver';
import { SecretsService } from '../secrets/secrets.service';
import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository } from './mcp-servers.repository';

@Injectable()
export class McpServerRuntimeConfigService {
  constructor(
    private readonly repository: McpServersRepository,
    private readonly encryption: McpServersEncryptionService,
    private readonly secretResolver: SecretResolver,
    private readonly secretsService: SecretsService,
  ) {}

  async buildRuntimeKey(auth: AuthContext, serverId: string): Promise<McpRuntimeKey> {
    const organizationId = requireRuntimeOrganization(auth.organizationId);
    const record = await this.repository.findById(serverId, { organizationId });
    assertRuntimeServerOwnership(record, organizationId);
    assertRuntimeServerEnabled(record);
    return (
      await this.runtimeIdentityForRecord(record, organizationId, principalPartitionFor(auth))
    ).runtimeKey;
  }

  /** Called only by an authenticated worker after that worker wins a lease reservation. */
  async resolveDefinition(runtimeKeyInput: McpRuntimeKey): Promise<McpResolvedRuntimeDefinition> {
    const runtimeKey = McpRuntimeKeySchema.parse(runtimeKeyInput);
    const organizationId = requireRuntimeOrganization(runtimeKey.organizationId);
    const record = await this.repository.findById(runtimeKey.sourceId, { organizationId });
    assertRuntimeServerOwnership(record, organizationId);
    assertRuntimeServerEnabled(record);

    const identity = await this.runtimeIdentityForRecord(
      record,
      organizationId,
      runtimeKey.principalPartitionHash,
    );
    if (JSON.stringify(identity.runtimeKey) !== JSON.stringify(runtimeKey)) {
      throw new ForbiddenException('MCP runtime configuration identity is stale or mismatched');
    }

    const auth: AuthContext = {
      userId: null,
      organizationId,
      roles: ['ADMIN'],
      isAuthenticated: true,
      provider: 'internal',
    };
    const secretVersions = new Map(
      identity.credentialDependencies.map((dependency) => [dependency.id, dependency.version]),
    );
    const definitionBase = {
      sourceId: record.id,
      configFingerprint: runtimeKey.configFingerprint,
      bindingFingerprint: runtimeKey.configFingerprint,
    } as const;

    if (record.transportType === 'http') {
      if (!record.endpoint) throw new BadRequestException('HTTP MCP server endpoint is missing');
      let headers: Record<string, string> | undefined;
      if (record.headers) {
        headers = await this.encryption.decryptHeaders({
          ciphertext: record.headers.ciphertext,
          iv: record.headers.iv,
          authTag: record.headers.authTag,
          keyId: record.headers.keyId,
        });
      }
      const resolved = await this.secretResolver.resolveMcpConfig(headers, null, {
        auth,
        secretVersions,
      });
      const endpoint = new URL(record.endpoint);
      const trustedLocal = resolveSentrisTrustProfile(process.env) === 'trusted-local';
      return McpResolvedRuntimeDefinitionSchema.parse({
        ...definitionBase,
        kind: 'remote-http',
        endpoint: endpoint.toString(),
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        ...(trustedLocal ? { allowedInternalHosts: [endpoint.hostname] } : {}),
      });
    }

    if (record.transportType !== 'stdio' || !record.command) {
      throw new BadRequestException('MCP server transport configuration is invalid');
    }
    let storedEnvironment: Record<string, string> | undefined;
    if (record.headers) {
      storedEnvironment = await this.encryption.decryptHeaders({
        ciphertext: record.headers.ciphertext,
        iv: record.headers.iv,
        authTag: record.headers.authTag,
        keyId: record.headers.keyId,
      });
    }
    const resolved = await this.secretResolver.resolveMcpConfig(storedEnvironment, record.args, {
      auth,
      secretVersions,
    });
    const credentialEnvironment = extractStdioEnvironment(resolved.headers);
    if (record.command === 'docker') {
      const parsed = parseDockerStdioDefinition(resolved.args ?? []);
      const environment = {
        ...(parsed.environment ?? {}),
        ...credentialEnvironment,
      };
      return McpResolvedRuntimeDefinitionSchema.parse({
        ...definitionBase,
        ...parsed,
        ...(Object.keys(environment).length > 0 ? { environment } : {}),
      });
    }
    return McpResolvedRuntimeDefinitionSchema.parse({
      ...definitionBase,
      kind: 'host-stdio',
      command: record.command,
      ...(resolved.args ? { args: resolved.args } : {}),
      ...(Object.keys(credentialEnvironment).length > 0
        ? { environment: credentialEnvironment }
        : {}),
    });
  }

  private async runtimeIdentityForRecord(
    record: McpServerRecord,
    organizationId: string,
    principalPartitionHash: string,
  ): Promise<{
    runtimeKey: McpRuntimeKey;
    credentialDependencies: { id: string; version: number }[];
  }> {
    const transport = record.transportType === 'http' ? 'http' : 'stdio';
    if (record.transportType !== transport) {
      throw new BadRequestException(`Unsupported MCP transport '${record.transportType}'`);
    }
    const auth = internalRuntimeAuth(organizationId);
    const activeReferenceSources =
      transport === 'http'
        ? [record.headerSecretReferences]
        : [record.headerSecretReferences, record.argSecretReferences];
    const credentialDependencies = activeReferenceSources.every((references) => references !== null)
      ? await Promise.all(
          [...new Set(activeReferenceSources.flatMap((references) => references ?? []))]
            .sort()
            .map(async (secretId) => {
              const secret = await this.secretsService.getSecret(auth, secretId);
              return {
                id: secret.id.toLowerCase(),
                version: secret.activeVersion?.version ?? 0,
              };
            }),
        )
      : (await this.secretsService.listSecrets(auth)).map((secret) => ({
          id: secret.id.toLowerCase(),
          version: secret.activeVersion?.version ?? 0,
        }));

    return {
      runtimeKey: McpRuntimeKeySchema.parse({
        sourceId: record.id,
        transport,
        configFingerprint: sha256({
          version: 2,
          serverId: record.id,
          organizationId: record.organizationId,
          transport,
          configuration:
            transport === 'http'
              ? { endpoint: record.endpoint, encryptedHeaders: record.headers }
              : {
                  command: record.command,
                  args: record.args,
                  ...(record.headers ? { encryptedEnvironment: record.headers } : {}),
                },
        }),
        organizationId,
        principalPartitionHash,
        credentialReference: `mcp-server:${record.id}`,
        credentialGeneration: credentialGenerationFor(credentialDependencies),
      }),
      credentialDependencies,
    };
  }
}

function extractStdioEnvironment(
  storedHeaders: Record<string, string> | null | undefined,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(storedHeaders ?? {})) {
    if (!key.startsWith('env:')) continue;
    const environmentKey = key.slice('env:'.length);
    if (!environmentKey) {
      throw new BadRequestException('MCP stdio environment key cannot be empty');
    }
    environment[environmentKey] = value;
  }
  return environment;
}

function credentialGenerationFor(dependencies: { id: string; version: number }[]): number {
  if (dependencies.length === 0) return 1;
  const fingerprint = sha256({
    version: 1,
    dependencies: [...dependencies].sort((left, right) => left.id.localeCompare(right.id)),
  });
  // Thirteen hex digits fit safely within JavaScript's integer precision.
  return Math.max(1, Number.parseInt(fingerprint.slice(0, 13), 16));
}

function internalRuntimeAuth(organizationId: string): AuthContext {
  return {
    userId: null,
    organizationId,
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'internal',
  };
}

function principalPartitionFor(auth: AuthContext): string {
  return sha256({
    organizationId: auth.organizationId,
    userId: auth.userId,
    provider: auth.provider,
    roles: [...auth.roles].sort(),
    apiKeyPermissions: auth.apiKeyPermissions,
  });
}

function requireRuntimeOrganization(organizationId: string | null): string {
  if (!organizationId) {
    throw new ForbiddenException('MCP runtimes require an organization scope');
  }
  return organizationId;
}

function assertRuntimeServerEnabled(record: McpServerRecord): void {
  if (!record.enabled) throw new ForbiddenException('MCP server is disabled');
}

function assertRuntimeServerOwnership(record: McpServerRecord, organizationId: string): void {
  if (record.organizationId === organizationId) return;
  if (
    record.organizationId === null &&
    resolveSentrisTrustProfile(process.env) === 'trusted-local'
  ) {
    return;
  }
  throw new ForbiddenException('MCP server does not belong to this organization');
}

function parseDockerStdioDefinition(args: string[]): {
  kind: 'docker-stdio';
  image: string;
  command?: string[];
  environment?: Record<string, string>;
  network?: string;
  volumes?: string[];
  mounts?: string[];
  workingDirectory?: string;
  user?: string;
  entrypoint?: string;
  readOnlyRootFilesystem?: boolean;
  init?: boolean;
} {
  if (args[0] !== 'run') {
    throw new BadRequestException("Docker MCP stdio configuration must begin with 'docker run'");
  }

  const environment: Record<string, string> = {};
  const volumes: string[] = [];
  const mounts: string[] = [];
  let network: string | undefined;
  let workingDirectory: string | undefined;
  let user: string | undefined;
  let entrypoint: string | undefined;
  let readOnlyRootFilesystem: boolean | undefined;
  let init: boolean | undefined;
  let index = 1;
  for (; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '-i' || argument === '--interactive' || argument === '--rm') continue;
    if (argument === '-e' || argument === '--env') {
      const assignment = args[++index];
      if (assignment === undefined) throw new BadRequestException(`${argument} requires a value`);
      addEnvironmentAssignment(environment, assignment);
      continue;
    }
    if (argument.startsWith('--env=')) {
      addEnvironmentAssignment(environment, argument.slice('--env='.length));
      continue;
    }
    if (argument === '--network') {
      network = args[++index];
      if (!network) throw new BadRequestException('--network requires a value');
      continue;
    }
    if (argument.startsWith('--network=')) {
      network = argument.slice('--network='.length);
      if (!network) throw new BadRequestException('--network requires a value');
      continue;
    }
    if (argument === '-v' || argument === '--volume') {
      volumes.push(requireDockerOptionValue(args, ++index, argument));
      continue;
    }
    if (argument.startsWith('--volume=')) {
      volumes.push(requireInlineDockerOptionValue(argument, '--volume='));
      continue;
    }
    if (argument.startsWith('-v=')) {
      volumes.push(requireInlineDockerOptionValue(argument, '-v='));
      continue;
    }
    if (argument === '--mount') {
      mounts.push(requireDockerOptionValue(args, ++index, argument));
      continue;
    }
    if (argument.startsWith('--mount=')) {
      mounts.push(requireInlineDockerOptionValue(argument, '--mount='));
      continue;
    }
    if (argument === '-w' || argument === '--workdir') {
      workingDirectory = requireDockerOptionValue(args, ++index, argument);
      continue;
    }
    if (argument.startsWith('--workdir=')) {
      workingDirectory = requireInlineDockerOptionValue(argument, '--workdir=');
      continue;
    }
    if (argument.startsWith('-w=')) {
      workingDirectory = requireInlineDockerOptionValue(argument, '-w=');
      continue;
    }
    if (argument === '-u' || argument === '--user') {
      user = requireDockerOptionValue(args, ++index, argument);
      continue;
    }
    if (argument.startsWith('--user=')) {
      user = requireInlineDockerOptionValue(argument, '--user=');
      continue;
    }
    if (argument.startsWith('-u=')) {
      user = requireInlineDockerOptionValue(argument, '-u=');
      continue;
    }
    if (argument === '--entrypoint') {
      entrypoint = requireDockerOptionValue(args, ++index, argument, true);
      continue;
    }
    if (argument.startsWith('--entrypoint=')) {
      entrypoint = argument.slice('--entrypoint='.length);
      continue;
    }
    if (argument === '--read-only') {
      readOnlyRootFilesystem = true;
      continue;
    }
    if (argument.startsWith('--read-only=')) {
      readOnlyRootFilesystem = parseDockerBoolean(
        argument.slice('--read-only='.length),
        '--read-only',
      );
      continue;
    }
    if (argument === '--init') {
      init = true;
      continue;
    }
    if (argument.startsWith('--init=')) {
      init = parseDockerBoolean(argument.slice('--init='.length), '--init');
      continue;
    }
    if (argument.startsWith('-')) {
      throw new BadRequestException(`Unsupported Docker MCP run option '${argument}'`);
    }
    break;
  }

  const image = args[index];
  if (!image) throw new BadRequestException('Docker MCP stdio configuration requires an image');
  const command = args.slice(index + 1);
  return {
    kind: 'docker-stdio',
    image,
    ...(command.length > 0 ? { command } : {}),
    ...(Object.keys(environment).length > 0 ? { environment } : {}),
    ...(network ? { network } : {}),
    ...(volumes.length > 0 ? { volumes } : {}),
    ...(mounts.length > 0 ? { mounts } : {}),
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
    ...(user !== undefined ? { user } : {}),
    ...(entrypoint !== undefined ? { entrypoint } : {}),
    ...(readOnlyRootFilesystem !== undefined ? { readOnlyRootFilesystem } : {}),
    ...(init !== undefined ? { init } : {}),
  };
}

function requireDockerOptionValue(
  args: string[],
  index: number,
  option: string,
  allowEmpty = false,
): string {
  const value = args[index];
  if (value === undefined || (!allowEmpty && value.length === 0)) {
    throw new BadRequestException(`${option} requires a value`);
  }
  return value;
}

function requireInlineDockerOptionValue(argument: string, prefix: string): string {
  const value = argument.slice(prefix.length);
  if (!value) throw new BadRequestException(`${prefix.slice(0, -1)} requires a value`);
  return value;
}

function parseDockerBoolean(value: string, option: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`${option} requires true or false`);
}

function addEnvironmentAssignment(environment: Record<string, string>, assignment: string): void {
  const separator = assignment.indexOf('=');
  if (separator <= 0) {
    throw new BadRequestException('Docker MCP environment entries must use KEY=VALUE');
  }
  const key = assignment.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new BadRequestException(`Docker MCP environment key '${key}' is invalid`);
  }
  environment[key] = assignment.slice(separator + 1);
}
