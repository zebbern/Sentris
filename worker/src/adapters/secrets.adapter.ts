import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ISecretsService, ServiceError } from '@sentris/component-sdk';
import { SecretEncryption, parseMasterKey } from '@sentris/shared';

import * as schema from './schema';

export class SecretsAdapter implements ISecretsService {
  private readonly encryption: SecretEncryption;

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly organizationId: string | null | undefined = undefined,
    encryption?: SecretEncryption,
  ) {
    if (encryption) {
      this.encryption = encryption;
    } else {
      const rawKey = process.env.SECRET_STORE_MASTER_KEY;
      if (!rawKey) {
        throw new Error('SECRET_STORE_MASTER_KEY environment variable is required');
      }
      this.encryption = new SecretEncryption(parseMasterKey(rawKey));
    }
  }

  forOrganization(organizationId: string | null): ISecretsService {
    if (this.organizationId === organizationId) {
      return this;
    }
    if (this.organizationId !== undefined) {
      throw new Error('Organization-scoped secrets service cannot be rebound');
    }
    return Object.freeze(new SecretsAdapter(this.db, organizationId, this.encryption));
  }

  async get(
    key: string,
    options?: { version?: number },
  ): Promise<{ value: string; version: number } | null> {
    const organizationId = this.requireOrganizationScope();
    // Check if key is a UUID (secret ID) or a name
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);

    const selection = {
      encryptedValue: schema.secretVersions.encryptedValue,
      iv: schema.secretVersions.iv,
      authTag: schema.secretVersions.authTag,
      keyId: schema.secretVersions.encryptionKeyId,
      versionNumber: schema.secretVersions.version,
    };
    const versionCondition =
      typeof options?.version === 'number'
        ? eq(schema.secretVersions.version, options.version)
        : eq(schema.secretVersions.isActive, true);
    let record:
      | {
          encryptedValue: string;
          iv: string;
          authTag: string;
          keyId: string;
          versionNumber: number;
        }
      | undefined;

    if (isUUID) {
      // The join enforces both ownership predicates in one round trip, so
      // inconsistent legacy rows cannot cross tenant boundaries.
      [record] = await this.db
        .select(selection)
        .from(schema.secretVersions)
        .innerJoin(schema.secrets, eq(schema.secretVersions.secretId, schema.secrets.id))
        .where(
          and(
            eq(schema.secrets.id, key),
            this.secretOrganizationPredicate(organizationId),
            this.secretVersionOrganizationPredicate(organizationId),
            versionCondition,
          ),
        )
        .limit(1);
    } else {
      // Key is a name, resolve it to a UUID
      const [secretRecord] = await this.db
        .select({ id: schema.secrets.id })
        .from(schema.secrets)
        .where(and(eq(schema.secrets.name, key), this.secretOrganizationPredicate(organizationId)))
        .limit(1);

      if (!secretRecord) {
        return null;
      }

      [record] = await this.db
        .select(selection)
        .from(schema.secretVersions)
        .where(
          and(
            eq(schema.secretVersions.secretId, secretRecord.id),
            this.secretVersionOrganizationPredicate(organizationId),
            versionCondition,
          ),
        )
        .limit(1);
    }

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
    const organizationId = this.requireOrganizationScope();
    const rows = await this.db
      .select({ name: schema.secrets.name })
      .from(schema.secrets)
      .where(this.secretOrganizationPredicate(organizationId))
      .orderBy(schema.secrets.name);
    return rows.map((row) => row.name);
  }

  private requireOrganizationScope(): string | null {
    if (this.organizationId === undefined) {
      throw new Error('SecretsAdapter must be bound to an organization before use');
    }
    return this.organizationId;
  }

  private secretOrganizationPredicate(organizationId: string | null): SQL {
    return organizationId === null
      ? isNull(schema.secrets.organizationId)
      : eq(schema.secrets.organizationId, organizationId);
  }

  private secretVersionOrganizationPredicate(organizationId: string | null): SQL {
    return organizationId === null
      ? isNull(schema.secretVersions.organizationId)
      : eq(schema.secretVersions.organizationId, organizationId);
  }
}
