import * as yaml from 'js-yaml';
import { Logger } from '@nestjs/common';

import type { NewRegistryCatalogRecord } from '../database/schema';
import { MAX_YAML_SIZE_BYTES } from './registry-featured';

const logger = new Logger('RegistryYamlParser');

/**
 * Represents the raw structure of a Docker MCP Registry server.yaml file.
 * Fields are intentionally loose — validated during transformation.
 */
interface RawServerYaml {
  type?: string;
  about?: {
    title?: string;
    description?: string;
    icon?: string;
  };
  meta?: {
    category?: string;
    tags?: string[];
  };
  source?: {
    project?: string;
  };
  image?: string;
  remote?: {
    transport_type?: string;
    url?: string;
    headers?: Record<string, string>;
  };
  config?: {
    secrets?: { name: string; env: string; example?: string }[];
    env?: { name: string; example?: string; value?: string }[];
    parameters?: Record<string, unknown>;
  };
  run?: {
    command?: string[];
    volumes?: string[];
    env?: Record<string, string>;
  };
  oauth?: {
    provider: string;
    secret?: string;
    env?: string;
  }[];
}

/**
 * Parse a Docker MCP Registry server.yaml file into a database record.
 *
 * @param name - Server name (directory name in the registry)
 * @param yamlContent - Raw YAML content
 * @returns Parsed record ready for DB insertion, or null if invalid
 */
export function parseServerYaml(
  name: string,
  yamlContent: string,
): Omit<NewRegistryCatalogRecord, 'id' | 'createdAt' | 'updatedAt' | 'syncedAt'> | null {
  if (yamlContent.length > MAX_YAML_SIZE_BYTES) {
    logger.warn(`Skipping ${name}: YAML content exceeds ${MAX_YAML_SIZE_BYTES} bytes`);
    return null;
  }

  let parsed: RawServerYaml;
  try {
    parsed = yaml.load(yamlContent) as RawServerYaml;
  } catch (error) {
    logger.warn(
      `Skipping ${name}: YAML parse error — ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    logger.warn(`Skipping ${name}: YAML content is not an object`);
    return null;
  }

  const displayName = parsed.about?.title?.trim();
  if (!displayName) {
    logger.warn(`Skipping ${name}: missing about.title (displayName)`);
    return null;
  }

  const serverType = parsed.type === 'remote' ? 'remote' : 'server';

  // Build remote config for remote servers
  let remoteConfig: NewRegistryCatalogRecord['remoteConfig'] = null;
  if (serverType === 'remote' && parsed.remote?.url) {
    remoteConfig = {
      transportType: parsed.remote.transport_type === 'sse' ? 'sse' : 'streamable-http',
      url: parsed.remote.url,
      ...(parsed.remote.headers ? { headers: parsed.remote.headers } : {}),
    };
  }

  return {
    name,
    displayName,
    description: parsed.about?.description?.trim() ?? null,
    serverType,
    category: parsed.meta?.category?.trim() ?? null,
    tags: parsed.meta?.tags ?? [],
    iconUrl: parsed.about?.icon ?? null,
    sourceUrl: parsed.source?.project ?? null,
    dockerImage: parsed.image ?? null,
    remoteConfig,
    configSchema: parsed.config ?? null,
    runConfig: parsed.run ?? null,
    oauthConfig: parsed.oauth ?? null,
    isFeatured: false, // Applied later by applyFeaturedBadges
    registryCommitSha: null,
  };
}
