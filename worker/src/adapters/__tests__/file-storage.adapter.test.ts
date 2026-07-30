import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'bun:test';
import { Client } from 'minio';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { FileStorageAdapter } from '../file-storage.adapter';
import * as schema from '../schema';
import { formatDatabaseTarget, getScriptDatabaseTarget } from '@sentris/local-runtime';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { IFileStorageService } from '@sentris/component-sdk';

const enableFileStorageIntegration = process.env.ENABLE_FILE_STORAGE_TESTS === 'true';
const fileStorageDescribe = enableFileStorageIntegration ? describe : describe.skip;
const dialect = new PgDialect();

function queryFor(condition: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(condition as Parameters<PgDialect['sqlToQuery']>[0]);
}

describe('FileStorageAdapter organization scope', () => {
  const foreignFileId = '22222222-2222-4222-8222-222222222222';
  const foreignFile = {
    id: foreignFileId,
    fileName: 'foreign.json',
    mimeType: 'application/json',
    size: 12,
    storageKey: 'organizations/org-b/foreign-file',
    organizationId: 'org-b',
    uploadedAt: new Date(),
  };

  it('does not download an organization B file from an organization A run', async () => {
    let lookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where(condition: unknown) {
                lookup = queryFor(condition);
                return {
                  limit() {
                    const hasOrgAFilter =
                      lookup?.sql.includes('"files"."organization_id"') &&
                      lookup.params.includes('org-a');
                    return Promise.resolve(hasOrgAFilter ? [] : [foreignFile]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const minio = {
      getObject: async () => Readable.from([Buffer.from('foreign')]),
    } as unknown as Client;
    const adapter = new FileStorageAdapter(minio, db, 'files');

    await expect(adapter.forOrganization('org-a').downloadFile(foreignFileId)).rejects.toThrow(
      `File not found: ${foreignFileId}`,
    );
    expect(lookup?.sql).toContain('"files"."organization_id"');
    expect(lookup?.params).toContain('org-a');
  });

  it('matches only null-owned files for trusted-local runs', async () => {
    let lookup: { sql: string; params: unknown[] } | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where(condition: unknown) {
                lookup = queryFor(condition);
                return {
                  limit() {
                    const restrictsToNullOwnedResources = lookup?.sql.includes(
                      '"files"."organization_id" is null',
                    );
                    return Promise.resolve(restrictsToNullOwnedResources ? [] : [foreignFile]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const adapter = new FileStorageAdapter({} as Client, db, 'files');

    await expect(adapter.forOrganization(null).getFileMetadata(foreignFileId)).rejects.toThrow(
      `File not found: ${foreignFileId}`,
    );
    expect(lookup?.sql).toContain('"files"."organization_id" is null');
  });

  it('rejects a foreign known UUID before it can overwrite the foreign object', async () => {
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return Promise.resolve([{ organizationId: 'org-b' }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const minio = {
      putObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as unknown as Client;
    const adapter = new FileStorageAdapter(minio, db, 'files');

    await expect(
      adapter
        .forOrganization('org-a')
        .uploadFile(foreignFileId, 'attempt.json', Buffer.from('{}'), 'application/json'),
    ).rejects.toThrow(`File identifier is already owned by another organization: ${foreignFileId}`);
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('uses disjoint object namespaces for trusted-local and similarly named organizations', async () => {
    const fileId = '44444444-4444-4444-8444-444444444444';
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate() {
                return {
                  returning() {
                    return Promise.resolve([{ id: fileId }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const putObject = vi.fn().mockResolvedValue(undefined);
    const minio = { putObject } as unknown as Client;
    const raw = new FileStorageAdapter(minio, db, 'files');

    await raw
      .forOrganization(null)
      .uploadFile(fileId, 'local.json', Buffer.from('{}'), 'application/json');
    await raw
      .forOrganization('trusted-local')
      .uploadFile(fileId, 'tenant.json', Buffer.from('{}'), 'application/json');

    const localStorageKey = putObject.mock.calls[0]?.[1];
    const tenantStorageKey = putObject.mock.calls[1]?.[1];
    expect(localStorageKey).toBe(`trusted-local/${fileId}`);
    expect(tenantStorageKey).toBe(`organizations/by-id/trusted-local/${fileId}`);
    expect(localStorageKey).not.toBe(tenantStorageKey);
  });

  it('rejects a foreign insert race through the conflict-update ownership predicate', async () => {
    let conflictWhere: { sql: string; params: unknown[] } | undefined;
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit() {
                    // The precheck runs before the foreign insert commits.
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate(config: { where: unknown }) {
                conflictWhere = queryFor(config.where);
                return {
                  returning() {
                    // PostgreSQL returns no row because the conflict-update WHERE
                    // rejects the now-foreign record.
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as NodePgDatabase<typeof schema>;
    const minio = {
      putObject: vi.fn().mockResolvedValue(undefined),
      removeObject: vi.fn().mockResolvedValue(undefined),
    } as unknown as Client;
    const adapter = new FileStorageAdapter(minio, db, 'files').forOrganization('org-a');

    await expect(
      adapter.uploadFile(foreignFileId, 'attempt.json', Buffer.from('{}'), 'application/json'),
    ).rejects.toThrow(`File identifier is already owned by another organization: ${foreignFileId}`);
    expect(conflictWhere?.sql).toContain('"files"."organization_id"');
    expect(conflictWhere?.params).toContain('org-a');
    expect(minio.removeObject).toHaveBeenCalledWith(
      'files',
      `organizations/by-id/org-a/${foreignFileId}`,
    );
  });

  it('does not let an organization-scoped capability mint another tenant scope', () => {
    const raw = new FileStorageAdapter({} as Client, {} as NodePgDatabase<typeof schema>, 'files');
    const scoped = raw.forOrganization('org-a');
    const trustedLocal = raw.forOrganization(null);

    expect(Object.isFrozen(scoped)).toBe(true);
    expect(scoped.forOrganization('org-a')).toBe(scoped);
    expect(trustedLocal.forOrganization(null)).toBe(trustedLocal);
    expect(() => scoped.forOrganization('org-b')).toThrow();
    expect(() => scoped.forOrganization(null)).toThrow();
    expect(() => trustedLocal.forOrganization('org-a')).toThrow();
  });

  it('rejects file operations on the raw unbound adapter', async () => {
    const raw = new FileStorageAdapter({} as Client, {} as NodePgDatabase<typeof schema>, 'files');

    await expect(raw.getFileMetadata(foreignFileId)).rejects.toThrow(
      'must be bound to an organization',
    );
  });
});

fileStorageDescribe('FileStorageAdapter (Integration)', () => {
  let minioClient: Client;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let adapter: IFileStorageService;
  const bucketName = 'test-sentris-files';

  beforeAll(async () => {
    const databaseTarget = getScriptDatabaseTarget({
      overrideEnvVar: 'FILE_STORAGE_TEST_DATABASE_URL',
    });

    // Initialize MinIO client
    minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    // Initialize PostgreSQL connection
    pool = new Pool({ connectionString: databaseTarget.connectionString });
    db = drizzle(pool, { schema });

    // Ensure test bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
    }

    // Create adapter
    adapter = new FileStorageAdapter(minioClient, db, bucketName).forOrganization(null);

    console.log(
      `✅ Test setup complete: MinIO + PostgreSQL connected (${formatDatabaseTarget(databaseTarget)})`,
    );
  });

  afterAll(async () => {
    // Cleanup: Remove test bucket (optional, commented out to preserve data)
    // const objectsList = minioClient.listObjects(bucketName, '', true);
    // for await (const obj of objectsList) {
    //   await minioClient.removeObject(bucketName, obj.name);
    // }
    // await minioClient.removeBucket(bucketName);

    await pool.end();
    console.log('✅ Test teardown complete');
  });

  beforeEach(async () => {
    // Clean up test files from database before each test
    await db.delete(schema.files);
  });

  describe('downloadFile', () => {
    it('should upload and download a text file', async () => {
      const fileId = randomUUID();
      const fileName = 'test.txt';
      const content = 'Hello, World!';
      const storageKey = `test-${fileId}.txt`;

      // Upload file to MinIO
      await minioClient.putObject(bucketName, storageKey, Buffer.from(content), content.length, {
        'Content-Type': 'text/plain',
      });

      // Insert metadata into database
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'text/plain',
        size: content.length,
        storageKey,
      });

      // Download using adapter
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer.toString('utf-8')).toBe(content);
      expect(result.metadata.id).toBe(fileId);
      expect(result.metadata.fileName).toBe(fileName);
      expect(result.metadata.mimeType).toBe('text/plain');
      expect(result.metadata.size).toBe(content.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });

    it('should upload and download a binary file', async () => {
      const fileId = randomUUID();
      const fileName = 'test.png';
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      const storageKey = `test-${fileId}.png`;

      // Upload binary file to MinIO
      await minioClient.putObject(bucketName, storageKey, binaryData, binaryData.length, {
        'Content-Type': 'image/png',
      });

      // Insert metadata into database
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'image/png',
        size: binaryData.length,
        storageKey,
      });

      // Download using adapter
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer).toEqual(binaryData);
      expect(result.metadata.mimeType).toBe('image/png');
      expect(result.metadata.size).toBe(binaryData.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });

    it('should throw error when file not found in database', async () => {
      const nonExistentId = randomUUID();

      await expect(adapter.downloadFile(nonExistentId)).rejects.toThrow(
        `File not found: ${nonExistentId}`,
      );
    });

    it('should throw error when file exists in DB but not in MinIO', async () => {
      const fileId = randomUUID();
      const storageKey = `missing-${fileId}.txt`;

      // Insert metadata but don't upload to MinIO
      await db.insert(schema.files).values({
        id: fileId,
        fileName: 'missing.txt',
        mimeType: 'text/plain',
        size: 100,
        storageKey,
      });

      // Should fail when trying to download from MinIO
      await expect(adapter.downloadFile(fileId)).rejects.toThrow();
    });

    it('should handle large files', async () => {
      const fileId = randomUUID();
      const fileName = 'large.bin';
      const largeData = Buffer.alloc(1024 * 1024); // 1MB
      largeData.fill('A');
      const storageKey = `test-${fileId}.bin`;

      // Upload large file
      await minioClient.putObject(bucketName, storageKey, largeData, largeData.length, {
        'Content-Type': 'application/octet-stream',
      });

      // Insert metadata
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'application/octet-stream',
        size: largeData.length,
        storageKey,
      });

      // Download and verify size
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer.length).toBe(largeData.length);
      expect(result.metadata.size).toBe(largeData.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    }, 10000); // 10 second timeout for large file
  });

  describe('getFileMetadata', () => {
    it('should retrieve file metadata without downloading', async () => {
      const fileId = randomUUID();
      const fileName = 'metadata-test.txt';
      const storageKey = `test-${fileId}.txt`;

      // Insert metadata
      const insertedAt = new Date();
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'text/plain',
        size: 1234,
        storageKey,
      });

      // Get metadata
      const metadata = await adapter.getFileMetadata(fileId);

      expect(metadata.id).toBe(fileId);
      expect(metadata.fileName).toBe(fileName);
      expect(metadata.mimeType).toBe('text/plain');
      expect(metadata.size).toBe(1234);
      expect(metadata.uploadedAt).toBeInstanceOf(Date);
      expect(metadata.uploadedAt.getTime()).toBeGreaterThanOrEqual(insertedAt.getTime() - 1000);
    });

    it('should throw error when file not found', async () => {
      const nonExistentId = randomUUID();

      await expect(adapter.getFileMetadata(nonExistentId)).rejects.toThrow(
        `File not found: ${nonExistentId}`,
      );
    });
  });

  describe('uploadFile helper', () => {
    it('should be idempotent when uploading the same file multiple times', async () => {
      const fileId = randomUUID();
      const initialContent = Buffer.from('initial payload');
      const updatedContent = Buffer.from('updated payload');
      const fileName = 'idempotent.txt';
      const mimeType = 'text/plain';

      await adapter.uploadFile(fileId, fileName, initialContent, mimeType);
      await adapter.uploadFile(fileId, fileName, updatedContent, mimeType);

      const [record] = await db.select().from(schema.files).where(eq(schema.files.id, fileId));

      expect(record).toBeTruthy();
      expect(record?.fileName).toBe(fileName);
      expect(record?.mimeType).toBe(mimeType);
      expect(record?.size).toBe(updatedContent.length);

      const downloaded = await adapter.downloadFile(fileId);
      expect(downloaded.buffer.toString('utf-8')).toBe(updatedContent.toString('utf-8'));

      await minioClient.removeObject(bucketName, record?.storageKey ?? fileId);
    });
  });

  describe('IFileStorageService interface compliance', () => {
    it('should implement all required methods', () => {
      expect(typeof adapter.downloadFile).toBe('function');
      expect(typeof adapter.getFileMetadata).toBe('function');
    });

    it('should return objects matching interface contracts', async () => {
      const fileId = randomUUID();
      const content = 'Interface test';
      const storageKey = `test-${fileId}.txt`;

      await minioClient.putObject(bucketName, storageKey, Buffer.from(content));
      await db.insert(schema.files).values({
        id: fileId,
        fileName: 'interface.txt',
        mimeType: 'text/plain',
        size: content.length,
        storageKey,
      });

      const downloadResult = await adapter.downloadFile(fileId);

      // Verify downloadFile return type
      expect(downloadResult).toHaveProperty('buffer');
      expect(downloadResult).toHaveProperty('metadata');
      expect(downloadResult.metadata).toHaveProperty('id');
      expect(downloadResult.metadata).toHaveProperty('fileName');
      expect(downloadResult.metadata).toHaveProperty('mimeType');
      expect(downloadResult.metadata).toHaveProperty('size');

      const metadataResult = await adapter.getFileMetadata(fileId);

      // Verify getFileMetadata return type
      expect(metadataResult).toHaveProperty('id');
      expect(metadataResult).toHaveProperty('fileName');
      expect(metadataResult).toHaveProperty('mimeType');
      expect(metadataResult).toHaveProperty('size');
      expect(metadataResult).toHaveProperty('uploadedAt');

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });
  });
});
