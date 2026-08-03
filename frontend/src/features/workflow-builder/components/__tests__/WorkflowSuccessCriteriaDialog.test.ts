import { describe, expect, it } from 'bun:test';

import { materializeSuccessCriteriaDrafts } from '../workflow-success-criteria';

describe('WorkflowSuccessCriteriaDialog', () => {
  it('materializes user-entered output and finding checks into the shared contract', () => {
    expect(
      materializeSuccessCriteriaDrafts([
        {
          id: 'score',
          title: 'Confidence is high enough',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/score',
          operator: 'gte',
          expectedText: '0.8',
        },
        {
          id: 'findings',
          title: 'Produces findings',
          kind: 'finding_count',
          minimum: '1',
          maximum: '',
        },
      ]),
    ).toEqual([
      {
        id: 'score',
        title: 'Confidence is high enough',
        kind: 'output_assertion',
        nodeRef: 'agent',
        path: '/score',
        operator: 'gte',
        expected: 0.8,
      },
      {
        id: 'findings',
        title: 'Produces findings',
        kind: 'finding_count',
        minimum: 1,
      },
    ]);
  });

  it('rejects a non-numeric threshold before saving', () => {
    expect(() =>
      materializeSuccessCriteriaDrafts([
        {
          id: 'score',
          title: 'Confidence threshold',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/score',
          operator: 'gte',
          expectedText: 'high',
        },
      ]),
    ).toThrow('Numeric checks require a valid number.');
  });
});
