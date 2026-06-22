import { describe, it, afterEach, expect, mock } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createSelectMock } from '@/test/mocks/radix-select';

mock.module('@/components/ui/select', createSelectMock);

const { RuntimeInputsEditor } = await import('../RuntimeInputsEditor');

describe('RuntimeInputsEditor', () => {
  afterEach(cleanup);

  it('allows boolean runtime inputs and edits boolean defaults as booleans', () => {
    const onChange = mock(() => {});

    render(
      <RuntimeInputsEditor
        value={
          [
            {
              id: 'includeDevDependencies',
              label: 'Include dev dependencies',
              type: 'boolean',
              required: false,
              defaultValue: false,
            },
          ] as any
        }
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('option', { name: 'Boolean' })).toBeInTheDocument();
    const defaultCheckbox = document.querySelector('#input-0-defaultValue');
    expect(defaultCheckbox).toHaveAttribute('role', 'checkbox');

    fireEvent.click(defaultCheckbox!);

    expect(onChange).toHaveBeenLastCalledWith([
      {
        id: 'includeDevDependencies',
        label: 'Include dev dependencies',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
    ]);
  });
});
