import { Client } from 'minio';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { IFileStorageService, NotFoundError } from '@sentris/component-sdk';
import * as schema from './schema';

/**
 * Adapter that implements IFileStorageService using MinIO + PostgreSQL
 */
export class FileStorageAdapter implements IFileStorageService {
  constructor(
    private minioClient: Client,
    private db: NodePgDatabase<typeof schema>,
    private bucketName: string,
    private readonly organizationId: string | null | undefined = undefined,
  ) {}

  forOrganization(organizationId: string | null): IFileStorageService {
    if (this.organizationId === organizationId) {
      return this;
    }
    if (this.organizationId !== undefined) {
      throw new Error('Organization-scoped file storage service cannot be rebound');
    }
    return Object.freeze(
      new FileStorageAdapter(this.minioClient, this.db, this.bucketName, organizationId),
    );
  }

  async downloadFile(fileId: string): Promise<{
    buffer: Buffer;
    metadata: {
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
  }> {
    const organizationId = this.requireOrganizationScope();
    // Get metadata from database
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, fileId), this.organizationPredicate(organizationId)))
      .limit(1);

    if (!file) {
      throw new NotFoundError(`File not found: ${fileId}`, {
        resourceType: 'file',
        resourceId: fileId,
      });
    }

    // Download from MinIO
    const stream = await this.minioClient.getObject(this.bucketName, file.storageKey);

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      metadata: {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
      },
    };
  }

  async getFileMetadata(fileId: string): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    uploadedAt: Date;
  }> {
    const organizationId = this.requireOrganizationScope();
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, fileId), this.organizationPredicate(organizationId)))
      .limit(1);

    if (!file) {
      throw new NotFoundError(`File not found: ${fileId}`, {
        resourceType: 'file',
        resourceId: fileId,
      });
    }

    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: file.uploadedAt,
    };
  }

  /**
   * Helper method to upload files (for testing and internal use)
   */
  async uploadFile(
    fileId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const organizationId = this.requireOrganizationScope();
    const [existingFile] = await this.db
      .select({ organizationId: schema.files.organizationId })
      .from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);

    if (existingFile && existingFile.organizationId !== organizationId) {
      throw new Error(`File identifier is already owned by another organization: ${fileId}`);
    }

    // Tenant namespace prevents a foreign UUID from overwriting another
    // organization's object before the database ownership check completes.
    const storageKey = this.storageKeyFor(fileId, organizationId);
    await this.minioClient.putObject(this.bucketName, storageKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });

    // Store metadata in database
    const updated = await this.db
      .insert(schema.files)
      .values({
        id: fileId,
        fileName,
        mimeType,
        size: buffer.length,
        storageKey,
        organizationId,
      })
      .onConflictDoUpdate({
        target: schema.files.id,
        where: this.organizationPredicate(organizationId),
        set: {
          fileName,
          mimeType,
          size: buffer.length,
          storageKey,
          organizationId,
          uploadedAt: schema.files.uploadedAt,
        },
      })
      .returning({ id: schema.files.id });

    if (updated.length === 0) {
      await this.minioClient.removeObject(this.bucketName, storageKey).catch(() => undefined);
      throw new Error(`File identifier is already owned by another organization: ${fileId}`);
    }
  }

  private requireOrganizationScope(): string | null {
    if (this.organizationId === undefined) {
      throw new Error('FileStorageAdapter must be bound to an organization before use');
    }
    return this.organizationId;
  }

  private organizationPredicate(organizationId: string | null): SQL {
    return organizationId === null
      ? isNull(schema.files.organizationId)
      : eq(schema.files.organizationId, organizationId);
  }

  private storageKeyFor(fileId: string, organizationId: string | null): string {
    if (organizationId === null) {
      return `trusted-local/${fileId}`;
    }
    return `organizations/by-id/${encodeURIComponent(organizationId)}/${fileId}`;
  }
}
