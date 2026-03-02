import { describe, it, expect, afterEach } from 'bun:test';
import { render, screen, cleanup } from '@testing-library/react';
import type { AgentDerivedStep } from '../types';

// ---------------------------------------------------------------------------
// Mock utilities
// ---------------------------------------------------------------------------

// ExpandableText is a sibling component — render it inline for testing
import { mock } from 'bun:test';

mock.module('../utils', () => ({
  formatClock: (ts: string) => {
    const d = new Date(ts);
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  },
  formatDuration: (ms: number) => `${ms}ms`,
  summarizeUnknown: (val: unknown) => {
    if (typeof val === 'string') return val;
    return JSON.stringify(val).slice(0, 60);
  },
}));

mock.module('../ExpandableText', () => ({
  ExpandableText: ({ text }: { text: string }) => <div data-testid="expandable-text">{text}</div>,
}));

import { AgentTranscriptTimeline } from '../AgentTranscriptTimeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<AgentDerivedStep> = {}): AgentDerivedStep {
  return {
    key: 'step-1',
    stepNumber: 1,
    finishReason: 'complete',
    thought: undefined,
    actions: [],
    observations: [],
    toolCallId: undefined,
    toolName: undefined,
    toolInput: undefined,
    toolOutput: undefined,
    timestamp: '2026-01-01T00:00:05Z',
    sequence: 1,
    startedAt: '2026-01-01T00:00:05Z',
    finishedAt: '2026-01-01T00:00:06Z',
    durationMs: 1000,
    isComplete: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentTranscriptTimeline', () => {
  afterEach(cleanup);

  it('shows empty message when no content provided', () => {
    render(<AgentTranscriptTimeline steps={[]} />);

    expect(screen.getByText('No agent activity captured yet.')).toBeTruthy();
  });

  it('renders prompt card when prompt is provided', () => {
    render(<AgentTranscriptTimeline prompt="Analyze this vulnerability report" steps={[]} />);

    expect(screen.getByText('Agent Prompt')).toBeTruthy();
    expect(screen.getByText('Analyze this vulnerability report')).toBeTruthy();
  });

  it('does not render prompt card for empty or whitespace prompt', () => {
    render(<AgentTranscriptTimeline prompt="   " steps={[]} />);

    expect(screen.queryByText('Agent Prompt')).toBeNull();
  });

  it('renders step cards with step number', () => {
    const steps = [makeStep({ key: 's1', stepNumber: 1 }), makeStep({ key: 's2', stepNumber: 2 })];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('Step 1')).toBeTruthy();
    expect(screen.getByText('Step 2')).toBeTruthy();
  });

  it('shows "complete" badge on finished steps', () => {
    const steps = [makeStep({ isComplete: true, finishReason: 'complete' })];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('complete')).toBeTruthy();
  });

  it('shows "working" badge on incomplete steps', () => {
    const steps = [makeStep({ isComplete: false })];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('working')).toBeTruthy();
  });

  it('shows "Waiting for tool output…" on incomplete steps', () => {
    const steps = [makeStep({ isComplete: false })];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('Waiting for tool output…')).toBeTruthy();
  });

  it('renders tool invocation details', () => {
    const steps = [
      makeStep({
        toolName: 'file_search',
        toolCallId: 'call-abc',
        toolInput: '*.ts',
        toolOutput: 'found 5 files',
      }),
    ];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('file_search')).toBeTruthy();
    expect(screen.getByText('Call ID: call-abc')).toBeTruthy();
  });

  it('renders final answer card', () => {
    render(<AgentTranscriptTimeline steps={[]} finalText="The vulnerability has been patched." />);

    expect(screen.getByText('Final Answer')).toBeTruthy();
    expect(screen.getByText('The vulnerability has been patched.')).toBeTruthy();
  });

  it('does not render final answer for empty text', () => {
    render(<AgentTranscriptTimeline steps={[]} finalText="  " />);

    expect(screen.queryByText('Final Answer')).toBeNull();
  });

  it('renders thought via ExpandableText', () => {
    const steps = [makeStep({ thought: 'Let me analyze the data' })];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByTestId('expandable-text')).toBeTruthy();
    expect(screen.getByText('Let me analyze the data')).toBeTruthy();
  });

  it('shows timing info on steps', () => {
    const steps = [
      makeStep({
        startedAt: '2026-01-01T12:30:00Z',
        finishedAt: '2026-01-01T12:30:05Z',
        durationMs: 5000,
      }),
    ];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('5000ms')).toBeTruthy();
  });

  it('renders multiple actions when more than one', () => {
    const steps = [
      makeStep({
        actions: [
          { toolName: 'read_file', toolCallId: 'c1', args: '/src/main.ts' },
          { toolName: 'grep_search', toolCallId: 'c2', args: 'pattern' },
        ],
      }),
    ];
    render(<AgentTranscriptTimeline steps={steps} />);

    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('read_file')).toBeTruthy();
    expect(screen.getByText('grep_search')).toBeTruthy();
  });

  it('renders all sections together: prompt + steps + final', () => {
    const steps = [makeStep({ key: 's1', stepNumber: 1 })];
    render(
      <AgentTranscriptTimeline prompt="Check for XSS" steps={steps} finalText="No XSS found." />,
    );

    expect(screen.getByText('Agent Prompt')).toBeTruthy();
    expect(screen.getByText('Step 1')).toBeTruthy();
    expect(screen.getByText('Final Answer')).toBeTruthy();
  });
});
