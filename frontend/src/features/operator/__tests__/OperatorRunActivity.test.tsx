import { afterEach, describe, expect, it, vi } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { OperatorRunActivity } from '../OperatorRunActivity';
import { queryKeys } from '@/lib/queryKeys';
import { createTestQueryClient, renderWithProviders } from '@/test/render-with-providers';

afterEach(cleanup);

function renderRun(status: string) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.executions.status('sentris-run-1'), { status });
  queryClient.setQueryData(queryKeys.executions.trace('sentris-run-1'), {
    events: [
      {
        nodeId: 'agent-node',
        data: { agentRunId: 'sentris-run-1:agent-node:agent-turn-1' },
      },
    ],
  });
  const onCommand = vi.fn();
  renderWithProviders(
    <OperatorRunActivity runId="sentris-run-1" disabled={false} onCommand={onCommand} />,
    { initialEntries: ['/operator/session-1'], queryClient },
  );
  return { onCommand };
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
});
