import { describe, expect, it } from 'bun:test';

import {
  FINDING_OBSERVATION_CONTRACT,
  FINDING_OBSERVATION_VERSION,
  FindingObservationV1Schema,
} from '../findingObservation.js';
import {
  buildFindingObservationIndexName,
  buildFindingObservationIndexPattern,
  buildTenantAnalyticsIndexName,
  createFindingObservationId,
} from '../findingObservationId.js';

describe('FindingObservation v1', () => {
  const canonicalBase = {
    contract: FINDING_OBSERVATION_CONTRACT,
    schema_version: FINDING_OBSERVATION_VERSION,
    finding_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
    observed_at: '2026-07-26T12:00:00.000Z',
    '@timestamp': '2026-07-26T12:00:00.000Z',
    severity: 'high' as const,
    title: 'SQL injection',
    description: 'Unsanitized input reaches a SQL query.',
    sentris: {
      organization_id: 'org-1',
      workflow_id: 'workflow-1',
      workflow_name: 'Web scan',
      run_id: 'run-1',
      scope_id: null,
      component_id: 'core.analytics.sink',
      node_ref: 'analytics',
      asset_key: null,
      contract_validated: true as const,
      contract_source_validated: true as const,
      contract_document_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
    },
  };

  it('accepts the canonical envelope while retaining component-specific analytics fields', () => {
    const result = FindingObservationV1Schema.parse({
      contract: FINDING_OBSERVATION_CONTRACT,
      schema_version: FINDING_OBSERVATION_VERSION,
      finding_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'SQL injection',
      description: 'Unsanitized input reaches a SQL query.',
      evidence: { parameter: 'id' },
      source: {
        scanner: 'nuclei',
        finding_hash: 'source-hash',
      },
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: 'scope-1',
        component_id: 'sentris.nuclei.scan',
        node_ref: 'nuclei',
        asset_key: 'https://example.test',
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
      },
      cwe: 'CWE-89',
      custom_analytics_score: 0.98,
    });

    expect(result.cwe).toBe('CWE-89');
    expect(result.custom_analytics_score).toBe(0.98);
    expect(result.sentris.scope_id).toBe('scope-1');
  });

  it('requires the versioned contract and authoritative identity envelope', () => {
    const result = FindingObservationV1Schema.safeParse({
      severity: 'high',
      title: 'Missing identity',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ['object', { scanner: 'nuclei', nested: [1, null, true] }],
    ['array', [{ scanner: 'nuclei' }, 'raw', 7, false, null]],
    ['string', 'nuclei'],
    ['number', 7],
    ['boolean', false],
    ['null', null],
  ])('preserves arbitrary JSON source and evidence values: %s', (_label, value) => {
    const parsed = FindingObservationV1Schema.parse({
      ...canonicalBase,
      source: value,
      evidence: value,
    });

    expect(parsed.source).toEqual(value);
    expect(parsed.evidence).toEqual(value);
  });

  it.each(['source', 'evidence'] as const)(
    'rejects a canonical observation when required JSON field %s is absent',
    (field) => {
      const observation: Record<string, unknown> = {
        ...canonicalBase,
        source: null,
        evidence: null,
      };
      delete observation[field];

      expect(FindingObservationV1Schema.safeParse(observation).success).toBe(false);
    },
  );

  it('requires a trusted-writer source attestation bound to the intended document ID', () => {
    const findingId = `fo_v1_${'0123456789abcdef'.repeat(4)}`;
    const result = FindingObservationV1Schema.safeParse({
      contract: FINDING_OBSERVATION_CONTRACT,
      schema_version: FINDING_OBSERVATION_VERSION,
      finding_id: findingId,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'Missing validation attestation',
      description: 'A shape-only document must not enter canonical aggregate coverage.',
      evidence: null,
      source: {},
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: null,
        component_id: 'core.analytics.sink',
        node_ref: 'analytics',
        asset_key: null,
        contract_validated: true,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty normalized title and description fields', () => {
    const result = FindingObservationV1Schema.safeParse({
      contract: FINDING_OBSERVATION_CONTRACT,
      schema_version: FINDING_OBSERVATION_VERSION,
      finding_id: `fo_v1_${'0123456789abcdef'.repeat(4)}`,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: '',
      description: '',
      evidence: null,
      source: {},
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: null,
        component_id: 'core.analytics.sink',
        node_ref: 'analytics',
        asset_key: null,
      },
    });

    expect(result.success).toBe(false);
  });

  it('generates the same observation ID for the same identity regardless of object key order', () => {
    const first = createFindingObservationId({
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
      scopeId: 'scope-1',
      componentId: 'sentris.nuclei.scan',
      nodeRef: 'nuclei',
      sourceFindingId: {
        templateId: 'CVE-2026-0001',
        matchedAt: 'https://example.test/login',
      },
    });
    const replay = createFindingObservationId({
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
      scopeId: 'scope-1',
      componentId: 'sentris.nuclei.scan',
      nodeRef: 'nuclei',
      sourceFindingId: {
        matchedAt: 'https://example.test/login',
        templateId: 'CVE-2026-0001',
      },
    });

    expect(first).toBe(replay);
    expect(first).toMatch(/^fo_v1_[a-f0-9]{64}$/);
  });

  it('does not collapse observations from different runs or tenants', () => {
    const identity = {
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
      scopeId: null,
      componentId: 'sentris.nuclei.scan',
      nodeRef: 'nuclei',
      sourceFindingId: 'stable-source-hash',
    };

    expect(createFindingObservationId(identity)).not.toBe(
      createFindingObservationId({ ...identity, runId: 'run-2' }),
    );
    expect(createFindingObservationId(identity)).not.toBe(
      createFindingObservationId({ ...identity, organizationId: 'org-2' }),
    );
  });

  it('rejects generic suffixes that alias canonical or legacy findings indexes', () => {
    expect(() => buildTenantAnalyticsIndexName('org-1', 'observations-v1')).toThrow(
      'reserved for canonical findings observations',
    );
    expect(() => buildTenantAnalyticsIndexName('org-1', 'custom-observations-v1')).toThrow(
      'reserved for canonical findings observations',
    );
    expect(() => buildTenantAnalyticsIndexName('org-1', '2026.07.26')).toThrow(
      'reserved for legacy findings indexes',
    );
  });

  it('keeps non-findings custom analytics suffixes available', () => {
    expect(buildTenantAnalyticsIndexName('org-1', 'custom-metrics')).toMatch(
      /^security-findings-o[a-f0-9]{64}-custom-metrics$/,
    );
  });

  it('keeps exact case-sensitive organization identities collision resistant', () => {
    const lower = buildFindingObservationIndexName('org-acme');
    const upper = buildFindingObservationIndexName('Org-Acme');

    expect(lower).not.toBe(upper);
    expect(buildFindingObservationIndexName(' org-acme')).not.toBe(lower);
    expect(lower).toMatch(/^security-findings-o[a-f0-9]{64}-observations-v1$/);
  });

  it('restricts the observation pattern to the observation index', () => {
    const observationIndex = buildFindingObservationIndexName('Org-1');

    expect(buildFindingObservationIndexPattern('Org-1')).toBe(observationIndex);
  });
});
