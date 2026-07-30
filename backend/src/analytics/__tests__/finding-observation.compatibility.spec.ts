import { describe, expect, it } from 'bun:test';
import {
  FINDING_OBSERVATION_CONTRACT,
  FINDING_OBSERVATION_VERSION,
  FindingObservationV1Schema,
} from '@sentris/shared';
import { createFindingObservationId } from '@sentris/shared/finding-observation-id';

import { mapFindingHit, mapFindingHitWithCompatibility } from '../finding-query';

describe('FindingObservation backend compatibility', () => {
  it('accepts the shared v1 envelope and maps canonical identity without dropping raw fields', () => {
    const findingId = createFindingObservationId({
      organizationId: 'org-1',
      workflowId: 'workflow-1',
      runId: 'run-1',
      scopeId: 'scope-1',
      componentId: 'core.analytics.sink',
      nodeRef: 'analytics',
      sourceFindingId: 'source-hash',
    });
    const observation = FindingObservationV1Schema.parse({
      contract: FINDING_OBSERVATION_CONTRACT,
      schema_version: FINDING_OBSERVATION_VERSION,
      finding_id: findingId,
      observed_at: '2026-07-26T12:00:00.000Z',
      '@timestamp': '2026-07-26T12:00:00.000Z',
      severity: 'high',
      title: 'SQL injection',
      description: 'Unsanitized input reaches a query.',
      evidence: { parameter: 'id' },
      source: { scanner: 'nuclei', finding_hash: 'source-hash' },
      sentris: {
        organization_id: 'org-1',
        workflow_id: 'workflow-1',
        workflow_name: 'Web scan',
        run_id: 'run-1',
        scope_id: 'scope-1',
        component_id: 'core.analytics.sink',
        node_ref: 'analytics',
        asset_key: 'https://example.test',
        contract_validated: true,
        contract_source_validated: true,
        contract_document_id: findingId,
      },
      custom_score: 0.97,
    });

    const item = mapFindingHit({ _id: findingId, _source: observation });

    expect(item).toMatchObject({
      id: findingId,
      schemaCompatibility: 'canonical',
      name: 'SQL injection',
      workflow_id: 'workflow-1',
      run_id: 'run-1',
      scope_id: 'scope-1',
      component_id: 'core.analytics.sink',
      node_ref: 'analytics',
    });
    expect(observation.custom_score).toBe(0.97);
  });

  it('uses an explicit legacy adapter for pre-contract documents', () => {
    const mapped = mapFindingHitWithCompatibility({
      _id: 'legacy-1',
      _source: {
        '@timestamp': '2025-01-01T00:00:00.000Z',
        severity: 'low',
        name: 'Legacy scanner output',
        run_id: 'run-legacy',
      },
    });

    expect(mapped.compatibility).toBe('legacy');
    expect(mapped.item).toMatchObject({
      id: 'legacy-1',
      schemaCompatibility: 'legacy',
      name: 'Legacy scanner output',
      run_id: 'run-legacy',
    });
  });

  it('retains malformed versioned evidence but marks it invalid for degraded coverage', () => {
    const mapped = mapFindingHitWithCompatibility({
      _id: 'invalid-1',
      _source: {
        contract: FINDING_OBSERVATION_CONTRACT,
        schema_version: FINDING_OBSERVATION_VERSION,
        '@timestamp': 'not-a-date',
        severity: 'impossible',
        title: '',
      },
    });

    expect(mapped.compatibility).toBe('invalid');
    expect(mapped.item.schemaCompatibility).toBe('invalid');
  });
});
