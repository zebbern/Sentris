import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SecretEncryption, parseMasterKey } from '@sentris/shared';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SecretsAdapter } from '../secrets.adapter';
import * as schema from '../schema';

const TEST_MASTER_KEY = '00112233445566778899aabbccddeeff';

interface VersionRow {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyId: string;
  versionNumber: number;
}

interface SecretsDbStubConfig {
  secret?: { id: string }[];
  versions?: VersionRow[];
  list?: { name: string }[];
}

const dialect = new PgDialect();

function queryFor(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]);
}

function createDbStub(config: SecretsDbStubConfig): NodePgDatabase<typeof schema> {
  return {
    select(selection: Record<string, unknown>) {
      if ('name' in selection) {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return Promise.resolve(config.list ?? []);
                  },
                };
              },
              orderBy() {
                return Promise.resolve(config.list ?? []);
              },
            };
          },
        };
      }

      const rows = 'encryptedValue' in selection ? (config.versions ?? []) : (config.secret ?? []);
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as NodePgDatabase<typeof schema>;
}

describe('SecretsAdapter', () => {
  let originalMasterKey: string | undefined;

  beforeEach(() => {
    originalMasterKey = process.env.SECRET_STORE_MASTER_KEY;
    process.env.SECRET_STORE_MASTER_KEY = TEST_MASTER_KEY;
  });

  afterEach(() => {
    if (originalMasterKey === undefined) {
      delete process.env.SECRET_STORE_MASTER_KEY;
    } else {
      process.env.SECRET_STORE_MASTER_KEY = originalMasterKey;
    }
  });

  it('decrypts the active secret version when no override is provided', async () => {
    const encryption = new SecretEncryption(parseMasterKey(TEST_MASTER_KEY));
    const encrypted = await encryption.encrypt('super-secret');

    const db = createDbStub({
      secret: [{ id: 'secret-1' }],
      versions: [
        {
          encryptedValue: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          versionNumber: 2,
        },
      ],
    });

    const adapter = new SecretsAdapter(db).forOrganization(null);
    const secret = await adapter.get('api-token');

    expect(secret).toEqual({ value: 'super-secret', version: 2 });
  });

  it('uses the requested version when provided', async () => {
    const encryption = new SecretEncryption(parseMasterKey(TEST_MASTER_KEY));
    const encrypted = await encryption.encrypt('older-secret');

    const db = createDbStub({
      secret: [{ id: 'secret-1' }],
      versions: [
        {
          encryptedValue: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyId: encrypted.keyId,
          versionNumber: 1,
        },
      ],
    });

    const adapter = new SecretsAdapter(db).forOrganization(null);
    const secret = await adapter.get('api-token', { version: 1 });

    expect(secret).toEqual({ value: 'older-secret', version: 1 });
  });

  it('returns null when the secret does not exist', async () => {
    const db = createDbStub({ versions: [] });
    const adapter = new SecretsAdapter(db).forOrganization(null);

    await expect(adapter.get('missing-secret')).resolves.toBeNull();
  });

  it('lists secret identifiers in the expected order', async () => {
    const db = createDbStub({
      list: [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }],
    });

    const adapter = new SecretsAdapter(db).forOrganization(null);
    await expect(adapter.list()).resolves.toEqual(['alpha', 'beta', 'gamma']);
  });

  it('does not resolve an organization B secret by a name used by organization A', async () => {
    let nameLookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where(condition: unknown) {
                nameLookup = queryFor(condition);
                return {
                  limit() {
                    const hasOrgAFilter =
                      nameLookup?.sql.includes('"secrets"."organization_id"') &&
                      nameLookup.params.includes('org-a');
                    return Promise.resolve(hasOrgAFilter ? [] : [{ id: 'org-b-secret-id' }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;

    const adapter = new SecretsAdapter(db);

    await expect(adapter.forOrganization('org-a').get('shared-api-token')).resolves.toBeNull();
    expect(nameLookup?.sql).toContain('"secrets"."organization_id"');
    expect(nameLookup?.params).toContain('org-a');
  });

  it('does not resolve a foreign UUID when the run organization is trusted-local', async () => {
    const foreignSecretId = '11111111-1111-4111-8111-111111111111';
    let versionLookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select(selection: Record<string, unknown>) {
        const isVersionLookup = 'encryptedValue' in selection;
        const where = (condition: unknown) => {
          versionLookup = queryFor(condition);
          return {
            limit() {
              const restrictsToNullOwnedResources = versionLookup?.sql.includes(
                '"secret_versions"."organization_id" is null',
              );
              return Promise.resolve(
                restrictsToNullOwnedResources
                  ? []
                  : isVersionLookup
                    ? [
                        {
                          encryptedValue: 'foreign-ciphertext',
                          iv: 'foreign-iv',
                          authTag: 'foreign-tag',
                          keyId: 'foreign-key',
                          versionNumber: 1,
                        },
                      ]
                    : [{ id: foreignSecretId }],
              );
            },
          };
        };
        return {
          from() {
            return {
              innerJoin() {
                return { where };
              },
              where,
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;

    const adapter = new SecretsAdapter(db).forOrganization(null);

    await expect(adapter.forOrganization(null).get(foreignSecretId)).resolves.toBeNull();
    expect(versionLookup?.sql).toContain('"secret_versions"."organization_id" is null');
  });

  it('loads a UUID with one joined query scoped to both secret and version ownership', async () => {
    const foreignSecretId = '33333333-3333-4333-8333-333333333333';
    let selectCount = 0;
    let joinLookup: { sql: string; params: unknown[] } | undefined;
    let scopedLookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select(selection: Record<string, unknown>) {
        selectCount += 1;
        const isSecretLookup = 'id' in selection;
        return {
          from() {
            return {
              innerJoin(_table: unknown, condition: unknown) {
                joinLookup = queryFor(condition);
                return {
                  where(condition: unknown) {
                    scopedLookup = queryFor(condition);
                    return {
                      limit() {
                        return Promise.resolve([]);
                      },
                    };
                  },
                };
              },
              where(condition: unknown) {
                scopedLookup = queryFor(condition);
                return {
                  limit() {
                    return Promise.resolve(isSecretLookup ? [{ id: foreignSecretId }] : []);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;

    await expect(
      new SecretsAdapter(db).forOrganization('org-a').get(foreignSecretId),
    ).resolves.toBeNull();
    expect(selectCount).toBe(1);
    expect(joinLookup?.sql).toContain('"secret_versions"."secret_id" = "secrets"."id"');
    expect(scopedLookup?.sql).toContain('"secrets"."id"');
    expect(scopedLookup?.sql).toContain('"secrets"."organization_id"');
    expect(scopedLookup?.sql).toContain('"secret_versions"."organization_id"');
    expect(scopedLookup?.params).toContain(foreignSecretId);
    expect(scopedLookup?.params.filter((param) => param === 'org-a')).toHaveLength(2);
  });

  it('decrypts a UUID result projected from the joined secret-version fields', async () => {
    const secretId = '55555555-5555-4555-8555-555555555555';
    const encryption = new SecretEncryption(parseMasterKey(TEST_MASTER_KEY));
    const encrypted = await encryption.encrypt('joined-uuid-secret');
    const physicalRow = new Map<unknown, unknown>([
      [schema.secretVersions.encryptedValue, encrypted.ciphertext],
      [schema.secretVersions.iv, encrypted.iv],
      [schema.secretVersions.authTag, encrypted.authTag],
      [schema.secretVersions.encryptionKeyId, encrypted.keyId],
      [schema.secretVersions.version, 7],
    ]);
    const db = {
      select(selection: Record<string, unknown>) {
        return {
          from() {
            return {
              innerJoin() {
                return {
                  where() {
                    return {
                      limit() {
                        const projectedRow = Object.fromEntries(
                          Object.entries(selection).map(([alias, column]) => [
                            alias,
                            physicalRow.get(column),
                          ]),
                        );
                        return Promise.resolve([projectedRow]);
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;

    const result = await new SecretsAdapter(db).forOrganization('org-a').get(secretId);

    expect(result).toEqual({ value: 'joined-uuid-secret', version: 7 });
  });

  it('does not let an organization-scoped capability mint another tenant scope', () => {
    const raw = new SecretsAdapter(createDbStub({}));
    const scoped = raw.forOrganization('org-a');
    const trustedLocal = raw.forOrganization(null);

    expect(Object.isFrozen(scoped)).toBe(true);
    expect(scoped.forOrganization('org-a')).toBe(scoped);
    expect(trustedLocal.forOrganization(null)).toBe(trustedLocal);
    expect(Reflect.get(scoped, 'encryption')).toBe(Reflect.get(raw, 'encryption'));
    expect(Reflect.get(trustedLocal, 'encryption')).toBe(Reflect.get(raw, 'encryption'));
    expect(() => scoped.forOrganization('org-b')).toThrow();
    expect(() => scoped.forOrganization(null)).toThrow();
    expect(() => trustedLocal.forOrganization('org-a')).toThrow();
  });

  it('rejects secret operations on the raw unbound adapter', async () => {
    const raw = new SecretsAdapter(createDbStub({ list: [{ name: 'foreign' }] }));

    await expect(raw.list()).rejects.toThrow('must be bound to an organization');
  });

  it('lists only secrets owned by the bound organization', async () => {
    let listLookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where(condition: unknown) {
                listLookup = queryFor(condition);
                return {
                  orderBy() {
                    const scopedToOrgA =
                      listLookup?.sql.includes('"secrets"."organization_id"') &&
                      listLookup.params.includes('org-a');
                    return Promise.resolve(
                      scopedToOrgA ? [{ name: 'org-a-token' }] : [{ name: 'org-b-token' }],
                    );
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;

    await expect(new SecretsAdapter(db).forOrganization('org-a').list()).resolves.toEqual([
      'org-a-token',
    ]);
  });
});
