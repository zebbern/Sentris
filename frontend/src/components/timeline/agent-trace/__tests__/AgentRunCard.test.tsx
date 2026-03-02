import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockLoading = false;
let mockError: string | null = null;
let mockCursor = 0;
let mockMessages: any[] | null = null;
let mockParts: any[] = [];
let mockSteps: any[] = [];

mock.module('@/components/timeline/agent-trace/hooks/useAgentTranscript', () => ({
  useAgentTranscript: () => ({
    loading: mockLoading,
    error: mockError,
    cursor: mockCursor,
    messages: mockMessages,
    parts: mockParts,
    steps: mockSteps,
  }),
}));

mock.module('@/components/timeline/agent-trace/hooks/useAgentChatTransport', () => ({
  useAgentChatTransport: () => null,
}));

const mockSendMessage = mock(async () => {});
const mockSetMessages = mock(() => {});

// IMPORTANT: Stable reference to prevent infinite re-render loops.
// The component has useEffect([messages,...]) that calls setVisibleMessages;
// a new array reference each render causes an infinite update cycle.
const STABLE_MESSAGES: any[] = [];

mock.module('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: STABLE_MESSAGES,
    sendMessage: mockSendMessage,
    status: 'idle',
    setMessages: mockSetMessages,
  }),
}));

let mockTimelineState: Record<string, any> = {
  playbackMode: 'replay',
  timelineStartTime: null,
  currentTime: 0,
  selectedRunId: 'run-1',
  setAgentMarkers: mock(() => {}),
};

mock.module('@/store/executionTimelineStore', () => {
  const useExecutionTimelineStore = ((selector?: any) => {
    return selector ? selector(mockTimelineState) : mockTimelineState;
  }) as any;
  useExecutionTimelineStore.getState = () => mockTimelineState;
  useExecutionTimelineStore.setState = () => {};
  useExecutionTimelineStore.subscribe = () => () => {};
  useExecutionTimelineStore.destroy = () => {};
  return { useExecutionTimelineStore };
});

mock.module('@/components/timeline/agent-trace/utils', () => ({
  extractAssistantText: () => '',
  chunksToMessages: async () => [],
}));

mock.module('@/components/timeline/agent-trace/AgentTranscriptTimeline', () => ({
  AgentTranscriptTimeline: (props: any) => (
    <div data-testid="agent-transcript">{props.prompt ?? ''}</div>
  ),
}));

import { AgentRunCard } from '../AgentRunCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(overrides: Record<string, any> = {}) {
  return {
    nodeId: 'agent-node-1',
    agentRunId: 'abcdefgh-1234-5678-9012-345678901234',
    runId: 'run-1',
    live: false,
    isSelected: false,
    onFocus: mock(() => {}),
    prompt: 'Hello agent',
    responseText: null,
    ...overrides,
  };
}

function resetMocks() {
  mockLoading = false;
  mockError = null;
  mockCursor = 0;
  mockMessages = null;
  mockParts = [];
  mockSteps = [];
  mockSendMessage.mockClear();
  mockSetMessages.mockClear();
  mockTimelineState = {
    playbackMode: 'replay',
    timelineStartTime: null,
    currentTime: 0,
    selectedRunId: 'run-1',
    setAgentMarkers: mock(() => {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentRunCard', () => {
  afterEach(() => {
    cleanup();
    resetMocks();
  });

  it('renders node ID and truncated agent run ID', () => {
    render(<AgentRunCard {...makeProps()} />);

    expect(screen.getByText('agent-node-1')).toBeTruthy();
    // Shows last 8 chars of agentRunId
    expect(screen.getByText('Run 78901234')).toBeTruthy();
  });

  it('shows loading state when transcript is hydrating', () => {
    mockLoading = true;
    render(<AgentRunCard {...makeProps()} />);

    expect(screen.getByText('Hydrating transcript…')).toBeTruthy();
  });

  it('shows error state when transcript fails to load', () => {
    mockLoading = false;
    mockError = 'Connection refused';
    render(<AgentRunCard {...makeProps()} />);

    expect(screen.getByText('Failed to load transcript: Connection refused')).toBeTruthy();
  });

  it('renders transcript timeline when data is available', () => {
    mockMessages = [];
    mockLoading = false;
    mockError = null;
    render(<AgentRunCard {...makeProps()} />);

    expect(screen.getByTestId('agent-transcript')).toBeTruthy();
  });

  it('applies selected state styling', () => {
    const { container } = render(<AgentRunCard {...makeProps({ isSelected: true })} />);

    const card = container.firstElementChild;
    expect(card?.className).toContain('border-primary');
  });

  it('shows Live badge when live prop is true', () => {
    render(<AgentRunCard {...makeProps({ live: true })} />);

    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('does not show Live badge when live prop is false', () => {
    render(<AgentRunCard {...makeProps({ live: false })} />);

    expect(screen.queryByText('Live')).toBeNull();
  });

  it('shows "Focused" button text when selected', () => {
    render(<AgentRunCard {...makeProps({ isSelected: true })} />);

    expect(screen.getByText('Focused')).toBeTruthy();
  });

  it('shows "Focus in timeline" button text when not selected', () => {
    render(<AgentRunCard {...makeProps({ isSelected: false })} />);

    expect(screen.getByText('Focus in timeline')).toBeTruthy();
  });

  it('calls onFocus when focus button is clicked', () => {
    const onFocus = mock(() => {});
    render(<AgentRunCard {...makeProps({ onFocus })} />);

    fireEvent.click(screen.getByText('Focus in timeline'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('shows live status text when live', () => {
    render(<AgentRunCard {...makeProps({ live: true })} />);

    expect(screen.getByText(/Status:/)).toBeTruthy();
  });
});
