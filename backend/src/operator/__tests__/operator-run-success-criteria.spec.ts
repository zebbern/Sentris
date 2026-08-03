import { describe, expect, it } from 'bun:test';

import {
  compareWorkflowSuccessCriteria,
  evaluateWorkflowSuccessCriterion,
} from '../operator-run-success-criteria';

describe('Operator workflow success criteria', () => {
  it('evaluates output JSON pointers and finding ranges deterministically', () => {
    const evidence = {
      outputs: { agent: { report: { summary: 'actionable result' }, score: 0.92 } },
      findings: { availability: 'available' as const, total: 2 },
    };
    expect(
      evaluateWorkflowSuccessCriterion(
        {
          id: 'summary',
          title: 'Produces an actionable summary',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/report/summary',
          operator: 'contains',
          expected: 'actionable',
        },
        evidence,
      ).outcome,
    ).toBe('passed');
    expect(
      evaluateWorkflowSuccessCriterion(
        {
          id: 'findings',
          title: 'Produces one to three findings',
          kind: 'finding_count',
          minimum: 1,
          maximum: 3,
        },
        evidence,
      ).outcome,
    ).toBe('passed');
  });

  it('marks missing successful outputs and degraded findings appropriately', () => {
    expect(
      evaluateWorkflowSuccessCriterion(
        {
          id: 'summary',
          title: 'Produces a summary',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/summary',
          operator: 'not_empty',
        },
        {
          outputs: { agent: {} },
          findings: { availability: 'available', total: 0 },
        },
      ).outcome,
    ).toBe('failed');
    expect(
      evaluateWorkflowSuccessCriterion(
        {
          id: 'findings',
          title: 'Produces findings',
          kind: 'finding_count',
          minimum: 1,
        },
        {
          outputs: null,
          findings: { availability: 'degraded', total: 1 },
        },
      ).outcome,
    ).toBe('inconclusive');
  });

  it('reports a directional improvement only when criteria do not conflict', () => {
    const comparison = compareWorkflowSuccessCriteria({
      criteria: [
        {
          id: 'summary',
          title: 'Produces a summary',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/summary',
          operator: 'not_empty',
        },
        {
          id: 'findings',
          title: 'Produces findings',
          kind: 'finding_count',
          minimum: 1,
        },
      ],
      source: {
        outputs: { agent: { summary: '' } },
        findings: { availability: 'available', total: 0 },
      },
      candidate: {
        outputs: { agent: { summary: 'usable' } },
        findings: { availability: 'available', total: 2 },
      },
    });
    expect(comparison.assessment).toBe('improved');
    expect(comparison.criteria.map((criterion) => criterion.assessment)).toEqual([
      'improved',
      'improved',
    ]);
  });

  it('does not claim a per-criterion direction for incomparable runs', () => {
    const comparison = compareWorkflowSuccessCriteria({
      comparable: false,
      criteria: [
        {
          id: 'summary',
          title: 'Produces a summary',
          kind: 'output_assertion',
          nodeRef: 'agent',
          path: '/summary',
          operator: 'not_empty',
        },
      ],
      source: {
        outputs: { agent: { summary: '' } },
        findings: { availability: 'available', total: 0 },
      },
      candidate: {
        outputs: { agent: { summary: 'usable' } },
        findings: { availability: 'available', total: 0 },
      },
    });

    expect(comparison.assessment).toBe('inconclusive');
    expect(comparison.criteria[0]?.assessment).toBe('inconclusive');
  });
});
