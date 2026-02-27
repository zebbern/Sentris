import { z } from 'zod';

export const ArtifactDestinationSchema = z.enum(['run', 'library']);
export type ArtifactDestination = z.infer<typeof ArtifactDestinationSchema>;

export const ArtifactRemoteUploadSchema = z.object({
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
export type ArtifactRemoteUpload = z.infer<typeof ArtifactRemoteUploadSchema>;

export const ArtifactMetadataDetailsSchema = z
  .object({
    remoteUploads: z.array(ArtifactRemoteUploadSchema).optional(),
  })
  .catchall(z.unknown());
export type ArtifactMetadataDetails = z.infer<typeof ArtifactMetadataDetailsSchema>;

export const ArtifactMetadataSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string().uuid().nullable(),
  componentId: z.string().optional().nullable(),
  componentRef: z.string(),
  fileId: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  destinations: z.array(ArtifactDestinationSchema).nonempty(),
  metadata: ArtifactMetadataDetailsSchema.optional(),
  organizationId: z.string().optional().nullable(),
  createdAt: z.string().datetime(),
});
export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

export const RunArtifactsResponseSchema = z.object({
  runId: z.string(),
  artifacts: z.array(ArtifactMetadataSchema),
});
export type RunArtifactsResponse = z.infer<typeof RunArtifactsResponseSchema>;

export const ArtifactLibraryListResponseSchema = z.object({
  artifacts: z.array(ArtifactMetadataSchema),
});
export type ArtifactLibraryListResponse = z.infer<typeof ArtifactLibraryListResponseSchema>;
