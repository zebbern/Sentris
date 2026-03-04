import { describe, expect, it } from 'bun:test';

import { validateTransition, VALID_TRANSITIONS } from '../triage-state-machine';
import type { FindingTriageStatus } from '../dto/triage-update.dto';
import { FINDING_TRIAGE_STATUSES } from '../dto/triage-update.dto';

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe('triage-state-machine — validateTransition', () => {
  describe('valid transitions', () => {
    const validCases: [FindingTriageStatus, FindingTriageStatus][] = [
      ['new', 'triaged'],
      ['new', 'wont_fix'],
      ['new', 'accepted_risk'],
      ['triaged', 'in_progress'],
      ['triaged', 'wont_fix'],
      ['triaged', 'accepted_risk'],
      ['in_progress', 'fixed'],
      ['in_progress', 'wont_fix'],
      ['in_progress', 'accepted_risk'],
      ['fixed', 'verified'],
      ['fixed', 'in_progress'],
      ['wont_fix', 'triaged'],
      ['accepted_risk', 'triaged'],
    ];

    it.each(validCases)('%s → %s is valid', (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(true);
      expect(result.allowedTransitions).toEqual(VALID_TRANSITIONS[from]);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid transitions
  // ---------------------------------------------------------------------------

  describe('invalid transitions', () => {
    const invalidCases: [FindingTriageStatus, FindingTriageStatus][] = [
      // Skip states
      ['new', 'fixed'],
      ['new', 'verified'],
      ['new', 'in_progress'],
      ['triaged', 'fixed'],
      ['triaged', 'verified'],

      // Terminal: verified has no outgoing transitions
      ['verified', 'new'],
      ['verified', 'triaged'],
      ['verified', 'in_progress'],
      ['verified', 'fixed'],
      ['verified', 'wont_fix'],
      ['verified', 'accepted_risk'],

      // Backward jumps
      ['in_progress', 'new'],
      ['in_progress', 'triaged'],
      ['fixed', 'new'],
      ['fixed', 'triaged'],

      // wont_fix / accepted_risk can only reopen to triaged
      ['wont_fix', 'new'],
      ['wont_fix', 'in_progress'],
      ['wont_fix', 'fixed'],
      ['wont_fix', 'verified'],
      ['accepted_risk', 'new'],
      ['accepted_risk', 'in_progress'],
      ['accepted_risk', 'fixed'],
      ['accepted_risk', 'verified'],
    ];

    it.each(invalidCases)('%s → %s is invalid', (from, to) => {
      const result = validateTransition(from, to);
      expect(result.valid).toBe(false);
      expect(result.allowedTransitions).toEqual(VALID_TRANSITIONS[from]);
    });
  });

  // ---------------------------------------------------------------------------
  // Same-state transitions
  // ---------------------------------------------------------------------------

  describe('same-state transitions', () => {
    it.each([...FINDING_TRIAGE_STATUSES])('%s → %s (same state) is invalid', (status) => {
      const result = validateTransition(status, status);
      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage: every status has an entry in VALID_TRANSITIONS
  // ---------------------------------------------------------------------------

  it('every FindingTriageStatus has an entry in VALID_TRANSITIONS', () => {
    for (const status of FINDING_TRIAGE_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
    }
  });

  it('verified is terminal (no outgoing transitions)', () => {
    expect(VALID_TRANSITIONS.verified).toEqual([]);
  });
});
