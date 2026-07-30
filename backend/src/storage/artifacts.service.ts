import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { requireOrganizationId } from '../common/auth/require-organization-id';
import { AuditLogService } from '../audit/audit-log.service';
import { ArtifactsRepository } from './artifacts.repository';
import { FilesService } from './files.service';
import type { ArtifactRecord } from '../database/schema/artifacts.schema';
import {
  ArtifactListResponseDto,
  ArtifactMetadataDto,
  RunArtifactsResponseDto,
} from './dto/artifact.dto';

type ArtifactDestination = 'run' | 'library';

interface ListArtifactFilters {
  workflowId?: string;
  componentId?: string;
  destination?: ArtifactDestination;
  search?: string;
  limit?: number;
}

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly repository: ArtifactsRepository,
    private readonly filesService: FilesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listRunArtifacts(
    auth: AuthContext | null,
    runId: string,
  ): Promise<RunArtifactsResponseDto> {
    const organizationId = requireOrganizationId(auth);
    const artifacts = await this.repository.listByRun(runId, { organizationId });
    return {
      runId,
      artifacts: artifacts.map((artifact) => this.toMetadata(artifact)),
    } as RunArtifactsResponseDto;
  }

  async listArtifacts(
    auth: AuthContext | null,
    filters: ListArtifactFilters,
  ): Promise<ArtifactListResponseDto> {
    const organizationId = requireOrganizationId(auth);
    const artifacts = await this.repository.list({
      ...filters,
      organizationId,
    });
    return {
      artifacts: artifacts.map((artifact) => this.toMetadata(artifact)),
    } as ArtifactListResponseDto;
  }

  async getArtifactRecord(auth: AuthContext | null, artifactId: string) {
    const organizationId = requireOrganizationId(auth);
    const artifact = await this.repository.findById(artifactId, { organizationId });
    if (!artifact) {
      throw new NotFoundException(`Artifact ${artifactId} not found`);
    }
    return artifact;
  }

  async downloadArtifact(auth: AuthContext | null, artifactId: string) {
    const artifact = await this.getArtifactRecord(auth, artifactId);
    const auditEvent = {
      action: 'artifact.download',
      resourceType: 'artifact' as const,
      resourceId: artifact.id,
      resourceName: artifact.name,
      metadata: {
        fileId: artifact.fileId,
        workflowId: artifact.workflowId,
        runId: artifact.runId ?? null,
        phase: 'requested',
      },
    };
    await this.auditLogService.recordDurable(auth, auditEvent);
    const download = await this.filesService.downloadFile(auth, artifact.fileId);
    return {
      artifact: this.toMetadata(artifact),
      file: download.file,
      buffer: download.buffer,
    };
  }

  async downloadArtifactForRun(auth: AuthContext | null, runId: string, artifactId: string) {
    const organizationId = requireOrganizationId(auth);
    const artifact = await this.repository.findByIdForRun(artifactId, runId, { organizationId });
    if (!artifact) {
      throw new NotFoundException(`Artifact ${artifactId} not found for run ${runId}`);
    }
    const auditEvent = {
      action: 'artifact.download',
      resourceType: 'artifact' as const,
      resourceId: artifact.id,
      resourceName: artifact.name,
      metadata: {
        fileId: artifact.fileId,
        workflowId: artifact.workflowId,
        runId,
        phase: 'requested',
      },
    };
    await this.auditLogService.recordDurable(auth, auditEvent);
    const download = await this.filesService.downloadFile(auth, artifact.fileId);
    return {
      artifact: this.toMetadata(artifact),
      file: download.file,
      buffer: download.buffer,
    };
  }

  async deleteArtifact(auth: AuthContext | null, artifactId: string): Promise<void> {
    const artifact = await this.getArtifactRecord(auth, artifactId);
    await this.auditLogService.recordDurable(auth, {
      action: 'artifact.delete',
      resourceType: 'artifact',
      resourceId: artifactId,
      resourceName: artifact.name,
      metadata: {
        fileId: artifact.fileId,
        workflowId: artifact.workflowId,
        runId: artifact.runId ?? null,
        phase: 'requested',
      },
    });

    // Deleting file metadata cascades the artifact row through the schema FK.
    // FilesService treats an absent object as idempotent but preserves the
    // database retry anchor when storage is genuinely unavailable.
    await this.filesService.deleteFile(auth, artifact.fileId);
  }

  private toMetadata(record: ArtifactRecord): ArtifactMetadataDto {
    return {
      id: record.id,
      runId: record.runId,
      workflowId: record.workflowId,
      workflowVersionId: record.workflowVersionId ?? null,
      componentId: record.componentId ?? null,
      componentRef: record.componentRef,
      fileId: record.fileId,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      destinations: record.destinations ?? ['run'],
      metadata: record.metadata ?? undefined,
      organizationId: record.organizationId ?? null,
      createdAt: (record.createdAt ?? new Date()).toISOString(),
    } as ArtifactMetadataDto;
  }
}
