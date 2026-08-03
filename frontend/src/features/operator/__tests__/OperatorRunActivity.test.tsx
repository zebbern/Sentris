import { afterEach, describe, expect, it, vi } from 'bun:test';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { OperatorRunActivity } from '../OperatorRunActivity';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { createTestQueryClient, renderWithProviders } from '@/test/render-with-providers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

class TestEventSource {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, payload: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(payload) });
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

function renderRun(
  status: string,
  options: {
    seedTrace?: boolean;
    sourceRunId?: string;
    statusData?: Record<string, unknown>;
    traceEvents?: Record<string, unknown>[];
  } = {},
) {
  const queryClient = createTestQueryClient();
  const statusData = {
    status,
    ...options.statusData,
  };
  vi.spyOn(api.executions, 'getStatus').mockResolvedValue(statusData as never);
  queryClient.setQueryData(queryKeys.executions.status('sentris-run-1'), statusData);
  if (options.seedTrace !== false) {
    queryClient.setQueryData(queryKeys.executions.trace('sentris-run-1'), {
      runId: 'sentris-run-1',
      events: options.traceEvents ?? [
        {
          nodeId: 'agent-node',
          data: { agentRunId: 'sentris-run-1:agent-node:agent-turn-1' },
        },
      ],
    });
  }
  const source = new TestEventSource();
  vi.spyOn(api.executions, 'stream').mockResolvedValue(source as unknown as EventSource);
  const onCommand = vi.fn();
  renderWithProviders(
    <OperatorRunActivity
      runId="sentris-run-1"
      sourceRunId={options.sourceRunId}
      disabled={false}
      onCommand={onCommand}
    />,
    { initialEntries: ['/operator/session-1'], queryClient },
  );
  return { onCommand, queryClient, source };
}

describe('OperatorRunActivity', () => {
  it('follows the canonical agent trace and emits an explicit cancel command', () => {
    const { onCommand } = renderRun('RUNNING');

    expect(screen.getByText('1 agent turn live')).toBeInTheDocument();
    expect(screen.getByText('Run t-turn-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCommand).toHaveBeenCalledWith({
      message: 'Cancel run sentris-run-1',
      directCommand: {
        commandName: 'cancel_run',
        arguments: { runId: 'sentris-run-1' },
      },
    });
  });

  it('offers durable review and retry controls after the run is terminal', () => {
    const { onCommand } = renderRun('FAILED', {
      statusData: { failure: { reason: 'The scanner exited unexpectedly.' } },
    });

    expect(screen.getByText('The scanner exited unexpectedly.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Improve with Operator' }));
    expect(onCommand).toHaveBeenCalledWith({
      message:
        'Improve run sentris-run-1: inspect its recorded evidence, propose the smallest justified workflow revision, save it under my approval mode, rerun the same inputs, and compare the result.',
      journey: { kind: 'improve_run', sourceRunId: 'sentris-run-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onCommand).toHaveBeenCalledWith({
      message: 'Retry run sentris-run-1 with the same workflow version and inputs',
      directCommand: {
        commandName: 'retry_run',
        arguments: { runId: 'sentris-run-1' },
      },
    });
  });

  it('offers an evidence comparison after an improved run is terminal', () => {
    const { onCommand } = renderRun('COMPLETED', {
      sourceRunId: 'sentris-run-source',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Compare with source' }));
    expect(onCommand).toHaveBeenCalledWith({
      message:
        'Compare improved run sentris-run-1 with source run sentris-run-source using recorded execution evidence',
      directCommand: {
        commandName: 'compare_runs',
        arguments: {
          sourceRunId: 'sentris-run-source',
          candidateRunId: 'sentris-run-1',
        },
      },
    });
  });

  it('loads terminal agent traces only when their activity is expanded', async () => {
    vi.spyOn(api.executions, 'getStatus').mockResolvedValue({
      status: 'COMPLETED',
      updatedAt: '2026-08-02T10:01:00.000Z',
    } as never);
    const getTrace = vi.spyOn(api.executions, 'getTrace').mockResolvedValue({ events: [] });

    renderRun('COMPLETED', { seedTrace: false });

    expect(getTrace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Agent activity'));

    await waitFor(() => expect(getTrace).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('No agent activity was recorded for this run.'),
    ).toBeInTheDocument();
  });

  it('shows compact streamed progress, current work, and polling fallback state', async () => {
    const { source } = renderRun('RUNNING', {
      statusData: { progress: { completedActions: 1, totalActions: 3 } },
      traceEvents: [
        {
          id: 'trace-1',
          runId: 'sentris-run-1',
          nodeId: 'nuclei-scan',
          type: 'PROGRESS',
          level: 'info',
          timestamp: '2026-08-02T10:00:00.000Z',
          message: 'Checking target templates',
        },
      ],
    });

    await waitFor(() => expect(api.executions.stream).toHaveBeenCalled());
    act(() => source.emit('ready', { mode: 'realtime', runId: 'sentris-run-1' }));

    expect(screen.getByText('Live updates')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 steps complete')).toBeInTheDocument();
    expect(screen.getByText('Checking target templates')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Workflow progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );

    act(() => source.emit('error', { message: 'status_fetch_failed' }));
    expect(screen.getByText('Updating every few seconds')).toBeInTheDocument();
  });
});
