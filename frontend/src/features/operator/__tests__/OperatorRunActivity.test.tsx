import { afterEach, describe, expect, it, vi } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { OperatorRunActivity } from '../OperatorRunActivity';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { createTestQueryClient, renderWithProviders } from '@/test/render-with-providers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderRun(status: string, options: { seedTrace?: boolean } = {}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.executions.status('sentris-run-1'), { status });
  if (options.seedTrace !== false) {
    queryClient.setQueryData(queryKeys.executions.trace('sentris-run-1'), {
      events: [
        {
          nodeId: 'agent-node',
          data: { agentRunId: 'sentris-run-1:agent-node:agent-turn-1' },
        },
      ],
    });
  }
  const onCommand = vi.fn();
  renderWithProviders(
    <OperatorRunActivity runId="sentris-run-1" disabled={false} onCommand={onCommand} />,
    { initialEntries: ['/operator/session-1'], queryClient },
  );
  return { onCommand, queryClient };
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
    const { onCommand } = renderRun('FAILED');

    expect(screen.getByRole('button', { name: 'Review result' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onCommand).toHaveBeenCalledWith({
      message: 'Retry run sentris-run-1 with the same workflow version and inputs',
      directCommand: {
        commandName: 'retry_run',
        arguments: { runId: 'sentris-run-1' },
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
});
