import { describe, expect, it } from 'bun:test';

import { getRemoteUploads } from '../artifacts';
import type { ArtifactMetadata } from '@sentris/shared';

function createArtifact(overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowVersionId: '00000000-0000-0000-0000-000000000002',
    componentRef: 'node-1',
    fileId: '00000000-0000-0000-0000-000000000003',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    destinations: ['run'],
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('getRemoteUploads', () => {
  it('returns remote uploads when metadata contains valid entries', () => {
    const artifact = createArtifact({
      metadata: {
        remoteUploads: [
          {
            type: 's3',
            bucket: 'my-bucket',
            key: 'reports/report.pdf',
            uri: 's3://my-bucket/reports/report.pdf',
            region: 'us-east-1',
          },
        ],
      },
    });

    const result = getRemoteUploads(artifact);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('s3');
    expect(result[0].bucket).toBe('my-bucket');
  });

  it('returns multiple remote uploads', () => {
    const artifact = createArtifact({
      metadata: {
        remoteUploads: [
          { type: 's3', bucket: 'b1', key: 'k1', uri: 's3://b1/k1' },
          { type: 'gcs', bucket: 'b2', key: 'k2', uri: 'gs://b2/k2' },
        ],
      },
    });

    const result = getRemoteUploads(artifact);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('s3');
    expect(result[1].type).toBe('gcs');
  });

  it('returns empty array when metadata is undefined', () => {
    const artifact = createArtifact({ metadata: undefined });
    expect(getRemoteUploads(artifact)).toEqual([]);
  });

  it('returns empty array when remoteUploads is undefined', () => {
    const artifact = createArtifact({ metadata: {} });
    expect(getRemoteUploads(artifact)).toEqual([]);
  });

  it('returns empty array when remoteUploads is an empty array', () => {
    const artifact = createArtifact({ metadata: { remoteUploads: [] } });
    expect(getRemoteUploads(artifact)).toEqual([]);
  });

  it('returns empty array when remoteUploads has invalid schema', () => {
    const artifact = createArtifact({
      metadata: {
        remoteUploads: [{ invalid: 'data' }] as unknown as never[],
      },
    });
    expect(getRemoteUploads(artifact)).toEqual([]);
  });
});
