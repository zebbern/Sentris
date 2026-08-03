import type { WorkflowSuccessCriterion } from '@sentris/shared';

interface OutputCriterionDraft {
  id: string;
  title: string;
  kind: 'output_assertion';
  nodeRef: string;
  path: string;
  operator: 'exists' | 'not_empty' | 'equals' | 'contains' | 'gte' | 'lte';
  expectedText: string;
}

interface FindingCriterionDraft {
  id: string;
  title: string;
  kind: 'finding_count';
  minimum: string;
  maximum: string;
}

export type CriterionDraft = OutputCriterionDraft | FindingCriterionDraft;

type OutputCriterion = Extract<WorkflowSuccessCriterion, { kind: 'output_assertion' }>;

function parseExpected(draft: OutputCriterionDraft): OutputCriterion['expected'] {
  if (draft.operator === 'contains') return draft.expectedText;
  if (draft.operator === 'gte' || draft.operator === 'lte') {
    const value = Number(draft.expectedText);
    if (!Number.isFinite(value)) throw new Error('Numeric checks require a valid number.');
    return value;
  }
  if (draft.operator === 'equals') {
    if (!draft.expectedText.trim()) throw new Error('Equals requires an expected value.');
    try {
      return JSON.parse(draft.expectedText) as OutputCriterion['expected'];
    } catch {
      return draft.expectedText;
    }
  }
  return undefined;
}

export function materializeSuccessCriteriaDrafts(
  drafts: CriterionDraft[],
): WorkflowSuccessCriterion[] {
  return drafts.map((draft) => {
    if (draft.kind === 'finding_count') {
      return {
        id: draft.id,
        title: draft.title,
        kind: draft.kind,
        ...(draft.minimum.trim() ? { minimum: Number(draft.minimum) } : {}),
        ...(draft.maximum.trim() ? { maximum: Number(draft.maximum) } : {}),
      };
    }
    const expected = parseExpected(draft);
    return {
      id: draft.id,
      title: draft.title,
      kind: draft.kind,
      nodeRef: draft.nodeRef,
      path: draft.path,
      operator: draft.operator,
      ...(expected !== undefined ? { expected } : {}),
    };
  });
}
