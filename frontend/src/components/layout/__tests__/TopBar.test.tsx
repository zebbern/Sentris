import { describe, it, beforeEach, afterEach, expect, mock } from 'bun:test';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createAlertDialogMock } from '@/test/mocks/dialog';
import { useExecutionStore } from '@/store/executionStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { useWorkflowUiStore } from '@/store/workflowUiStore';

mock.module('@/components/ui/alert-dialog', createAlertDialogMock);

const { TopBar } = await import('../TopBar');

const iso = () => new Date().toISOString();

const resetStores = () => {
  useExecutionStore.getState().reset();
  useWorkflowStore.setState({
    metadata: {
      id: 'workflow-1',
      name: 'Demo Workflow',
      description: '',
      currentVersionId: null,
      currentVersion: null,
    },
    isDirty: false,
  });
  useWorkflowUiStore.setState({ mode: 'design' });
};

const hasDom = typeof document !== 'undefined';
const describeTopBar = hasDom ? describe : describe.skip;

describeTopBar('TopBar', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(cleanup);

  it('does not show progress information (removed for cleaner UI)', () => {
    useExecutionStore.setState({
      status: 'running',
      runStatus: {
        runId: 'run-1',
        workflowId: 'workflow-1',
        status: 'RUNNING',
        startedAt: iso(),
        updatedAt: iso(),
        taskQueue: 'sentris-default',
        historyLength: 10,
        progress: { completedActions: 2, totalActions: 5 },
      },
    });

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={mock()} onSave={mock()} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('2/5 actions')).not.toBeInTheDocument();
  });

  it('keeps failure context out of the builder top bar', () => {
    useExecutionStore.setState({
      status: 'failed',
      runStatus: {
        runId: 'run-1',
        workflowId: 'workflow-1',
        status: 'FAILED',
        startedAt: iso(),
        updatedAt: iso(),
        taskQueue: 'sentris-default',
        historyLength: 3,
        failure: { reason: 'ValidationError' },
      },
    });

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={mock()} onSave={mock()} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Failed: ValidationError')).not.toBeInTheDocument();
  });

  it('shows save-before-run dialog when Run is clicked with unsaved changes', () => {
    useWorkflowStore.setState({ isDirty: true });
    const onRun = mock(() => {});

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={onRun} onSave={mock(() => Promise.resolve())} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(screen.getByText('Want to save current state?')).toBeInTheDocument();
    expect(onRun).not.toHaveBeenCalled();
  });

  it('calls onRun directly when workflow is clean', () => {
    const onRun = mock(() => {});

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={onRun} onSave={mock(() => Promise.resolve())} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Want to save current state?')).not.toBeInTheDocument();
  });

  it('Save & Run saves then runs when dialog is confirmed', async () => {
    useWorkflowStore.setState({ isDirty: true });
    const onRun = mock(() => {});
    const onSave = mock(async () => {
      useWorkflowStore.setState({ isDirty: false });
    });

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={onRun} onSave={onSave} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Run' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onRun).toHaveBeenCalledTimes(1);
    });
  });

  it('Save only persists without running', async () => {
    useWorkflowStore.setState({ isDirty: true });
    const onRun = mock(() => {});
    const onSave = mock(async () => {
      useWorkflowStore.setState({ isDirty: false });
    });

    render(
      <MemoryRouter>
        <TopBar workflowId="workflow-1" onRun={onRun} onSave={onSave} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onRun).not.toHaveBeenCalled();
    });
  });
});
