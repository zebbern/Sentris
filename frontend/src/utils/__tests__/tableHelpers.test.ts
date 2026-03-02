import { describe, expect, it } from 'bun:test';

import { getWorkflowName, getStatusBadgeProps } from '../tableHelpers';
import type { WorkflowOption, BadgeVariant } from '../tableHelpers';

describe('getWorkflowName', () => {
  const workflows: WorkflowOption[] = [
    { id: 'wf-1', name: 'Vulnerability Scan' },
    { id: 'wf-2', name: 'Dependency Audit' },
  ];

  it('returns the name for a matching workflow ID', () => {
    expect(getWorkflowName('wf-1', workflows)).toBe('Vulnerability Scan');
  });

  it('returns the name for another matching workflow ID', () => {
    expect(getWorkflowName('wf-2', workflows)).toBe('Dependency Audit');
  });

  it('returns "Unknown workflow" for a non-matching ID', () => {
    expect(getWorkflowName('wf-999', workflows)).toBe('Unknown workflow');
  });

  it('returns "Unknown workflow" for an empty workflows array', () => {
    expect(getWorkflowName('wf-1', [])).toBe('Unknown workflow');
  });
});

describe('getStatusBadgeProps', () => {
  const variants: Record<string, BadgeVariant> = {
    active: 'default',
    paused: 'secondary',
    error: 'destructive',
  };

  it('returns correct variant and label for a known status', () => {
    const result = getStatusBadgeProps('active', variants);
    expect(result.variant).toBe('default');
    expect(result.label).toBe('Active');
  });

  it('capitalizes the first letter for the label', () => {
    const result = getStatusBadgeProps('paused', variants);
    expect(result.label).toBe('Paused');
  });

  it('returns destructive variant for error status', () => {
    const result = getStatusBadgeProps('error', variants);
    expect(result.variant).toBe('destructive');
  });

  it('falls back to outline variant for unknown status', () => {
    const result = getStatusBadgeProps('unknown', variants);
    expect(result.variant).toBe('outline');
    expect(result.label).toBe('Unknown');
  });

  it('handles single-character status', () => {
    const result = getStatusBadgeProps('x', {});
    expect(result.label).toBe('X');
    expect(result.variant).toBe('outline');
  });
});
