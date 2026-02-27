import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const ArtifactDestinationSchema = z.enum(['run', 'library']);

const ArtifactRemoteUploadSchema = z.object({
  type: z.enum(['s3', 'gcs']),
  bucket: z.string(),
  key: z.string(),
  uri: z.string(),
  region: z.string().optional(),
  size: z.number().nonnegative().optional(),
  etag: z.string().optional(),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ArtifactMetadataDetailsSchema = z
  .object({
    remoteUploads: z.array(ArtifactRemoteUploadSchema).optional(),
  })
  .catchall(z.unknown());

const ArtifactMetadataSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  workflowId: z.string().uuid(),
  workflowVersionId: z.string().uuid().nullable().optional(),
  componentId: z.string().nullable().optional(),
  componentRef: z.string(),
  fileId: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  destinations: z.array(ArtifactDestinationSchema),
  metadata: ArtifactMetadataDetailsSchema.nullable().optional(),
  organizationId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

const RunArtifactsResponseSchema = z.object({
  runId: z.string(),
  artifacts: z.array(ArtifactMetadataSchema),
});

const ArtifactListResponseSchema = z.object({
  artifacts: z.array(ArtifactMetadataSchema),
});

export class ArtifactMetadataDto extends createZodDto(ArtifactMetadataSchema) {}

export class RunArtifactsResponseDto extends createZodDto(RunArtifactsResponseSchema) {}

export class ArtifactListResponseDto extends createZodDto(ArtifactListResponseSchema) {}
