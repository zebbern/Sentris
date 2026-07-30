import { expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useAutoFocusOnCompletion } from '../useAutoFocusOnCompletion';

it('waits for the terminal artifact refresh before choosing the result tab', () => {
  type AutoFocusOptions = Parameters<typeof useAutoFocusOnCompletion>[0];
  const setInspectorTab = mock();
  const selectNode = mock();
  const userOverrodeTab = { current: false };
  const baseOptions = {
    selectedRunId: 'run-1',
    nodeIOData: {
      nodes: [
        {
          nodeRef: 'report-node',
          componentId: 'core.artifact.writer',
          status: 'success',
          outputs: { artifactId: 'artifact-1' },
        },
      ],
    },
    hasAgentTrace: false,
    setInspectorTab,
    selectNode,
    userOverrodeTab,
  };

  const { rerender } = renderHook(
    (options: AutoFocusOptions) => useAutoFocusOnCompletion(options),
    {
      initialProps: {
        ...baseOptions,
        runStatus: 'RUNNING',
        artifactCount: 0,
        artifactsFetching: false,
      },
    },
  );

  rerender({
    ...baseOptions,
    runStatus: 'COMPLETED',
    artifactCount: 0,
    artifactsFetching: true,
  });

  expect(setInspectorTab).not.toHaveBeenCalled();

  rerender({
    ...baseOptions,
    runStatus: 'COMPLETED',
    artifactCount: 1,
    artifactsFetching: false,
  });

  expect(setInspectorTab).toHaveBeenCalledWith('artifacts');
  expect(selectNode).toHaveBeenCalledWith('report-node');
});
