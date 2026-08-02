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
let mockTransport: object | null = null;

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
  useAgentChatTransport: () => mockTransport,
}));

const mockSendMessage = mock(async () => {});
const mockSetMessages = mock(() => {});
const mockInvalidateQueries = mock(async () => {});

mock.module('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

mock.module('@/lib/queryKeys', () => ({
  queryKeys: {
    agents: {
      transcript: (agentRunId: string) => ['agentTranscript', 'test-org', agentRunId],
    },
  },
}));

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
  mockTransport = null;
  mockSendMessage.mockClear();
  mockSetMessages.mockClear();
  mockInvalidateQueries.mockClear();
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

  it('does not stream or show live state when the hydrated transcript already finished', () => {
    mockCursor = 7;
    mockMessages = [];
    mockTransport = {};
    mockParts = [
      {
        sequence: 7,
        timestamp: '2026-08-02T10:00:00.000Z',
        chunk: { type: 'finish', finishReason: 'stop' },
      },
    ];

    render(<AgentRunCard {...makeProps({ live: true })} />);

    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Status:/)).toBeNull();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('resumes streaming after the hydrated cursor while the agent is still active', () => {
    mockCursor = 7;
    mockMessages = [];
    mockTransport = {};
    mockParts = [
      {
        sequence: 7,
        timestamp: '2026-08-02T10:00:00.000Z',
        chunk: { type: 'text-delta', id: 'text-1', delta: 'working' },
      },
    ];

    render(<AgentRunCard {...makeProps({ live: true })} />);

    expect(screen.getByText('Live')).toBeTruthy();
    expect(mockSendMessage).toHaveBeenCalledWith(undefined, { body: { cursor: 7 } });
  });

  it('can settle a terminal run transcript without showing a false live state', () => {
    mockCursor = 7;
    mockMessages = [];
    mockTransport = {};
    mockParts = [
      {
        sequence: 7,
        timestamp: '2026-08-02T10:00:00.000Z',
        chunk: { type: 'text-delta', id: 'text-1', delta: 'finishing' },
      },
    ];

    render(<AgentRunCard {...makeProps({ live: false, follow: true })} />);

    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Status:/)).toBeNull();
    expect(mockSendMessage).toHaveBeenCalledWith(undefined, { body: { cursor: 7 } });
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

  it('refreshes the persisted transcript when a live run becomes terminal', () => {
    const props = makeProps({ live: true });
    const { rerender } = render(<AgentRunCard {...props} />);

    rerender(<AgentRunCard {...props} live={false} />);

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['agentTranscript', 'test-org', props.agentRunId],
    });
  });
});
