import { describe, expect, it } from 'bun:test';
import type { ArtifactMetadata } from '@sentris/shared';
import {
  decodeArtifactPreview,
  getArtifactPreviewEligibility,
  INLINE_ARTIFACT_PREVIEW_MAX_BYTES,
} from '../useArtifactQueries';

const artifact = (overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'run-1',
  workflowId: 'workflow-1',
  workflowVersionId: null,
  componentRef: 'core.artifact.writer',
  fileId: '22222222-2222-4222-8222-222222222222',
  name: 'results.json',
  mimeType: 'application/json',
  size: 42,
  destinations: ['run'],
  createdAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
});

describe('artifact preview helpers', () => {
  it('only marks small text and JSON artifacts as previewable', () => {
    expect(getArtifactPreviewEligibility(artifact())).toBe('previewable');
    expect(
      getArtifactPreviewEligibility(artifact({ mimeType: 'text/plain', name: 'results.txt' })),
    ).toBe('previewable');
    expect(
      getArtifactPreviewEligibility(artifact({ size: INLINE_ARTIFACT_PREVIEW_MAX_BYTES + 1 })),
    ).toBe('too-large');
    expect(
      getArtifactPreviewEligibility(artifact({ mimeType: 'application/pdf', name: 'report.pdf' })),
    ).toBe('unsupported');
  });

  it('formats valid JSON as readable plain text without interpreting markup', async () => {
    const preview = await decodeArtifactPreview(
      artifact(),
      new Blob(['{"finding":"<script>alert(1)</script>","severity":"high"}'], {
        type: 'application/json',
      }),
    );

    expect(preview).toEqual({
      status: 'ready',
      content: '{\n  "finding": "<script>alert(1)</script>",\n  "severity": "high"\n}',
    });
  });

  it('refuses a downloaded blob that is larger than the inline limit', async () => {
    const preview = await decodeArtifactPreview(
      artifact(),
      new Blob(['x'.repeat(INLINE_ARTIFACT_PREVIEW_MAX_BYTES + 1)], {
        type: 'application/json',
      }),
    );

    expect(preview).toEqual({ status: 'too-large' });
  });
});
