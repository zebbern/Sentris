import type { FindingTriageStatus } from './dto/triage-update.dto';

/**
 * Valid status transitions for the finding triage lifecycle.
 * Maps each status to the list of statuses it can transition to.
 */
export const VALID_TRANSITIONS: Record<FindingTriageStatus, readonly FindingTriageStatus[]> = {
  new: ['triaged', 'wont_fix', 'accepted_risk'],
  triaged: ['in_progress', 'wont_fix', 'accepted_risk'],
  in_progress: ['fixed', 'wont_fix', 'accepted_risk'],
  fixed: ['verified', 'in_progress'],
  verified: [],
  wont_fix: ['triaged'],
  accepted_risk: ['triaged'],
};

/**
 * Validate whether a status transition is allowed.
 * @returns Object with `valid` flag and list of allowed transitions from `currentStatus`.
 */
export function validateTransition(
  currentStatus: FindingTriageStatus,
  targetStatus: FindingTriageStatus,
): { valid: boolean; allowedTransitions: readonly FindingTriageStatus[] } {
  const allowed = VALID_TRANSITIONS[currentStatus];
  return { valid: allowed.includes(targetStatus), allowedTransitions: allowed };
}
