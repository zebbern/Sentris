import { isDeepStrictEqual } from 'node:util';

import type {
  FindingDataAvailability,
  OperatorRunComparisonAssessment,
  OperatorSuccessCriterionComparison,
  OperatorSuccessCriterionEvaluation,
  WorkflowSuccessCriterion,
} from '@sentris/shared';

interface SuccessCriteriaRunEvidence {
  outputs: Record<string, unknown> | null;
  findings: {
    availability: FindingDataAvailability;
    total: number | null;
  };
}

const MAX_ACTUAL_CHARACTERS = 600;

function boundedActual(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  if (serialized.length <= MAX_ACTUAL_CHARACTERS) return serialized;
  return `${serialized.slice(0, MAX_ACTUAL_CHARACTERS)}…`;
}

function evaluation(
  outcome: OperatorSuccessCriterionEvaluation['outcome'],
  message: string,
  actual?: unknown,
): OperatorSuccessCriterionEvaluation {
  return {
    outcome,
    message,
    ...(actual !== undefined ? { actual: boundedActual(actual) } : {}),
  };
}

function resolveJsonPointer(root: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === '') return { found: true, value: root };
  let current = root;
  for (const encodedSegment of pointer.slice(1).split('/')) {
    const segment = encodedSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { found: false };
      const index = Number(segment);
      if (!Object.hasOwn(current, index)) return { found: false };
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function isNotEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' || Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function evaluateWorkflowSuccessCriterion(
  criterion: WorkflowSuccessCriterion,
  evidence: SuccessCriteriaRunEvidence,
): OperatorSuccessCriterionEvaluation {
  switch (criterion.kind) {
    case 'finding_count': {
      if (evidence.findings.availability !== 'available' || evidence.findings.total === null) {
        return evaluation('inconclusive', 'Finding data was degraded or unavailable');
      }
      const total = evidence.findings.total;
      const meetsMinimum = criterion.minimum === undefined || total >= criterion.minimum;
      const meetsMaximum = criterion.maximum === undefined || total <= criterion.maximum;
      return meetsMinimum && meetsMaximum
        ? evaluation('passed', `Finding count ${total} met the declared range`, total)
        : evaluation('failed', `Finding count ${total} did not meet the declared range`, total);
    }
    case 'output_assertion': {
      if (!evidence.outputs) {
        return evaluation('inconclusive', 'Successful workflow outputs were unavailable');
      }
      if (!Object.hasOwn(evidence.outputs, criterion.nodeRef)) {
        return evaluation('failed', `Node ${criterion.nodeRef} produced no recorded output`);
      }
      const resolved = resolveJsonPointer(evidence.outputs[criterion.nodeRef], criterion.path);
      if (!resolved.found) {
        return evaluation('failed', `Output ${criterion.nodeRef}${criterion.path} was not present`);
      }
      const actual = resolved.value;
      switch (criterion.operator) {
        case 'exists':
          return evaluation('passed', 'The declared output was present', actual);
        case 'not_empty':
          return isNotEmpty(actual)
            ? evaluation('passed', 'The declared output was not empty', actual)
            : evaluation('failed', 'The declared output was empty', actual);
        case 'equals':
          return isDeepStrictEqual(actual, criterion.expected)
            ? evaluation('passed', 'The declared output matched the expected value', actual)
            : evaluation('failed', 'The declared output did not match the expected value', actual);
        case 'contains':
          return typeof criterion.expected === 'string' &&
            typeof actual === 'string' &&
            actual.includes(criterion.expected)
            ? evaluation('passed', 'The declared output contained the expected text', actual)
            : evaluation('failed', 'The declared output did not contain the expected text', actual);
        case 'gte':
          return typeof criterion.expected === 'number' &&
            typeof actual === 'number' &&
            actual >= criterion.expected
            ? evaluation('passed', 'The declared output met the minimum value', actual)
            : evaluation('failed', 'The declared output was below the minimum value', actual);
        case 'lte':
          return typeof criterion.expected === 'number' &&
            typeof actual === 'number' &&
            actual <= criterion.expected
            ? evaluation('passed', 'The declared output met the maximum value', actual)
            : evaluation('failed', 'The declared output exceeded the maximum value', actual);
        default: {
          const unsupported: never = criterion.operator;
          throw new Error(`Unsupported output assertion operator: ${String(unsupported)}`);
        }
      }
    }
    default: {
      const unsupported: never = criterion;
      throw new Error(`Unsupported workflow success criterion: ${String(unsupported)}`);
    }
  }
}

function compareCriterionOutcome(
  source: OperatorSuccessCriterionEvaluation,
  candidate: OperatorSuccessCriterionEvaluation,
): OperatorRunComparisonAssessment {
  if (source.outcome === 'inconclusive' || candidate.outcome === 'inconclusive') {
    return 'inconclusive';
  }
  if (source.outcome === candidate.outcome) return 'unchanged';
  return source.outcome === 'failed' ? 'improved' : 'regressed';
}

export function compareWorkflowSuccessCriteria(input: {
  criteria: WorkflowSuccessCriterion[];
  source: SuccessCriteriaRunEvidence;
  candidate: SuccessCriteriaRunEvidence;
  comparable?: boolean;
}): {
  criteria: OperatorSuccessCriterionComparison[];
  assessment: OperatorRunComparisonAssessment;
} {
  const criteria = input.criteria.map((criterion) => {
    const source = evaluateWorkflowSuccessCriterion(criterion, input.source);
    const candidate = evaluateWorkflowSuccessCriterion(criterion, input.candidate);
    return {
      criterion,
      source,
      candidate,
      assessment:
        input.comparable === false ? 'inconclusive' : compareCriterionOutcome(source, candidate),
    };
  });
  const assessments = new Set(criteria.map((criterion) => criterion.assessment));
  let assessment: OperatorRunComparisonAssessment = 'unchanged';
  if (assessments.has('improved') && assessments.has('regressed')) {
    assessment = 'inconclusive';
  } else if (assessments.has('improved')) {
    assessment = 'improved';
  } else if (assessments.has('regressed')) {
    assessment = 'regressed';
  } else if (assessments.has('inconclusive')) {
    assessment = 'inconclusive';
  }
  return { criteria, assessment };
}
