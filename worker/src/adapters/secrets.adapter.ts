import { and, eq, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ISecretsService, ServiceError } from '@sentris/component-sdk';
import { SecretEncryption, parseMasterKey } from '@sentris/shared';

import * as schema from './schema';

export class SecretsAdapter implements ISecretsService {
  private readonly encryption: SecretEncryption;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {
    const rawKey = process.env.SECRET_STORE_MASTER_KEY;
    if (!rawKey) {
      throw new Error('SECRET_STORE_MASTER_KEY environment variable is required');
    }
    this.encryption = new SecretEncryption(parseMasterKey(rawKey));
  }

  async get(
    key: string,
    options?: { version?: number },
  ): Promise<{ value: string; version: number } | null> {
    // Check if key is a UUID (secret ID) or a name
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);

    let secretId: string;
    if (isUUID) {
      // Key is already a UUID, use it directly
      secretId = key;
    } else {
      // Key is a name, resolve it to a UUID
      const [secretRecord] = await this.db
        .select({ id: schema.secrets.id })
        .from(schema.secrets)
        .where(eq(schema.secrets.name, key))
        .limit(1);

      if (!secretRecord) {
        return null;
      }
      secretId = secretRecord.id;
    }

    const conditions: SQL[] = [eq(schema.secretVersions.secretId, secretId)];

    if (typeof options?.version === 'number') {
      conditions.push(eq(schema.secretVersions.version, options.version));
    } else {
      conditions.push(eq(schema.secretVersions.isActive, true));
    }

    const [record] = await this.db
      .select({
        encryptedValue: schema.secretVersions.encryptedValue,
        iv: schema.secretVersions.iv,
        authTag: schema.secretVersions.authTag,
        keyId: schema.secretVersions.encryptionKeyId,
        versionNumber: schema.secretVersions.version,
      })
      .from(schema.secretVersions)
      .where(and(...conditions))
      .limit(1);

    if (!record) {
      return null;
    }

    try {
      const value = await this.encryption.decrypt({
        ciphertext: record.encryptedValue,
        iv: record.iv,
        authTag: record.authTag,
        keyId: record.keyId,
      });

      return { value, version: options?.version ?? record.versionNumber };
    } catch (error: unknown) {
      throw new ServiceError(`Failed to decrypt secret '${key}'`, {
        cause: error instanceof Error ? error : undefined,
        details: { secretKey: key, keyId: record.keyId },
      });
    }
  }

  async list(): Promise<string[]> {
    const rows = await this.db
      .select({ name: schema.secrets.name })
      .from(schema.secrets)
      .orderBy(schema.secrets.name);
    return rows.map((row) => row.name);
  }
}
