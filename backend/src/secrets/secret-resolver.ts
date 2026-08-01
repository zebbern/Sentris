/**
 * Secret Resolution Utility
 *
 * Resolves secret references in strings and objects.
 * Secret reference format: {{secret:SECRET_ID}}
 */

import { Injectable } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import type { AuthContext } from '../auth/types';

const SECRET_REF_REGEX = /\{\{secret:([a-f0-9-]+)\}\}/gi;

export interface McpSecretReferences {
  headers: string[];
  args: string[];
}

/**
 * Extracts stable secret dependency metadata without reading any secret value.
 * Keeping header and argument references separate lets partial MCP server updates
 * replace one source without losing the dependencies owned by the other.
 */
export function extractMcpSecretReferences(
  headers: Record<string, string> | null | undefined,
  args: string[] | null | undefined,
): McpSecretReferences {
  return {
    headers: extractSecretReferenceIds(headers ? Object.values(headers) : []),
    args: extractSecretReferenceIds(args ?? []),
  };
}

function extractSecretReferenceIds(values: string[]): string[] {
  const references = new Set<string>();
  for (const value of values) {
    const regex = new RegExp(SECRET_REF_REGEX.source, SECRET_REF_REGEX.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      references.add(match[1]!.toLowerCase());
    }
  }
  return [...references].sort();
}

export interface ResolveSecretsOptions {
  auth: AuthContext | null;
  /** Exact immutable versions captured while deriving a runtime identity. */
  secretVersions?: ReadonlyMap<string, number>;
}

export interface ResolvedConfig {
  headers?: Record<string, string> | null;
  args?: string[] | null;
}

@Injectable()
export class SecretResolver {
  constructor(private readonly secretsService: SecretsService) {}

  /**
   * Resolves all secret references in a string
   */
  async resolveString(value: string, options: ResolveSecretsOptions): Promise<string> {
    const { auth } = options;

    // Replace all {{secret:SECRET_ID}} references
    const replacements = new Map<string, string>();

    let match: RegExpExecArray | null;
    const regex = new RegExp(SECRET_REF_REGEX.source, SECRET_REF_REGEX.flags);

    while ((match = regex.exec(value)) !== null) {
      const secretId = match[1];
      if (!replacements.has(secretId)) {
        const pinnedVersion = options.secretVersions?.get(secretId.toLowerCase());
        if (options.secretVersions && pinnedVersion === undefined) {
          throw new Error(`Secret ${secretId} is missing from the pinned runtime identity`);
        }
        const secretValue = await this.secretsService.getSecretValue(auth, secretId, pinnedVersion);
        replacements.set(secretId, secretValue.value);
      }
    }

    // Replace all occurrences using regex
    let result = value;
    replacements.forEach((resolvedValue, secretId) => {
      const refRegex = new RegExp(`\\{\\{secret:${secretId}\\}\\}`, 'gi');
      result = result.replace(refRegex, resolvedValue);
    });

    return result;
  }

  /**
   * Resolves secret references in a record (object) of strings
   */
  async resolveRecord(
    record: Record<string, string>,
    options: ResolveSecretsOptions,
  ): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(record)) {
      resolved[key] = await this.resolveString(value, options);
    }

    return resolved;
  }

  /**
   * Resolves secret references in an array of strings (e.g., args)
   */
  async resolveArray(array: string[], options: ResolveSecretsOptions): Promise<string[]> {
    const resolved: string[] = [];

    for (const item of array) {
      resolved.push(await this.resolveString(item, options));
    }

    return resolved;
  }

  /**
   * Resolves secrets in MCP server configuration
   */
  async resolveMcpConfig(
    headers: Record<string, string> | null | undefined,
    args: string[] | null | undefined,
    options: ResolveSecretsOptions,
  ): Promise<ResolvedConfig> {
    const result: ResolvedConfig = {};

    if (headers) {
      result.headers = await this.resolveRecord(headers, options);
    }

    if (args) {
      result.args = await this.resolveArray(args, options);
    }

    return result;
  }
}
