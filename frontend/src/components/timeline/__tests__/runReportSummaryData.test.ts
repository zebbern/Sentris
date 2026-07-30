import { describe, expect, it } from 'bun:test';
import type { ArtifactMetadata } from '@sentris/shared';
import { extractRunReportSummary, selectReportArtifact } from '../runReportSummaryData';

const artifact = (overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({
  id: '11111111-1111-4111-8111-111111111111',
  runId: 'run-1',
  workflowId: 'workflow-1',
  workflowVersionId: null,
  componentRef: 'core.artifact.writer',
  fileId: '22222222-2222-4222-8222-222222222222',
  name: 'report.json',
  mimeType: 'application/json',
  size: 128,
  destinations: ['run'],
  createdAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
});

describe('selectReportArtifact', () => {
  it('prefers a previewable JSON report from the artifact writer', () => {
    const selected = selectReportArtifact([
      artifact({
        id: '33333333-3333-4333-8333-333333333333',
        componentRef: 'other.component',
        name: 'workflow-report.json',
      }),
      artifact({
        id: '44444444-4444-4444-8444-444444444444',
        mimeType: 'application/pdf',
        name: 'security-report.pdf',
      }),
      artifact({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'scan-brief.json',
      }),
      artifact({
        id: '66666666-6666-4666-8666-666666666666',
        size: 300_000,
        name: 'oversized-report.json',
      }),
    ]);

    expect(selected?.id).toBe('55555555-5555-4555-8555-555555555555');
  });
});

describe('extractRunReportSummary', () => {
  it('extracts a root summary with a warning and next steps', () => {
    expect(
      extractRunReportSummary(
        JSON.stringify({
          summary: { packagesChecked: 3, vulnerablePackages: 0, highestSeverity: null },
          warnings: ['NVD lookup was unavailable', 'Ignored second warning'],
          nextSteps: ['Retry later', 'Review lockfile', 'Ignored third action'],
        }),
      ),
    ).toEqual({
      metrics: [
        { label: 'Packages checked', value: '3' },
        { label: 'Vulnerable packages', value: '0' },
      ],
      notice: 'NVD lookup was unavailable',
      nextSteps: ['Retry later', 'Review lockfile'],
    });
  });

  it('uses the report envelope and preserves zero and false metrics', () => {
    expect(
      extractRunReportSummary(
        JSON.stringify({
          report: {
            summary: { findingsClosed: 0, remediationRequired: false },
            recommendations: ['Review the affected dependency', 'Ignored second recommendation'],
            nextSteps: ['Open the report'],
          },
        }),
      ),
    ).toEqual({
      metrics: [
        { label: 'Findings closed', value: '0' },
        { label: 'Remediation required', value: 'false' },
      ],
      notice: 'Review the affected dependency',
      nextSteps: ['Open the report'],
    });
  });

  it('uses the brief envelope and top-level notice fields', () => {
    expect(
      extractRunReportSummary(
        JSON.stringify({
          warnings: ['Credential source could not be verified'],
          nextSteps: ['Check the source integration'],
          brief: { summary: { assetsScanned: 12 } },
        }),
      ),
    ).toEqual({
      metrics: [{ label: 'Assets scanned', value: '12' }],
      notice: 'Credential source could not be verified',
      nextSteps: ['Check the source integration'],
    });
  });

  it('bounds metrics and actions while excluding non-scalar values', () => {
    const longValue = 'x'.repeat(100);

    expect(
      extractRunReportSummary(
        JSON.stringify({
          summary: {
            firstMetric: 1,
            secondMetric: 2,
            nested: { ignored: true },
            thirdMetric: 3,
            list: ['ignored'],
            fourthMetric: longValue,
            fifthMetric: 5,
          },
          nextSteps: ['First action', 'Second action', 'Ignored action'],
        }),
      ),
    ).toEqual({
      metrics: [
        { label: 'First metric', value: '1' },
        { label: 'Second metric', value: '2' },
        { label: 'Third metric', value: '3' },
        { label: 'Fourth metric', value: 'x'.repeat(80) },
      ],
      notice: null,
      nextSteps: ['First action', 'Second action'],
    });
  });

  it('returns null for malformed JSON', () => {
    expect(extractRunReportSummary('{not json')).toBeNull();
  });
});
