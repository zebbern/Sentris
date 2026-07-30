import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';

mock.module('../McpLibraryToolSelector', () => ({
  McpLibraryToolSelector: ({
    onToolExclusionsChange,
    useAllEnabled,
  }: {
    onToolExclusionsChange: (exclusions: string[]) => void;
    useAllEnabled?: boolean;
  }) => (
    <>
      {useAllEnabled && <span>All enabled mode</span>}
      <button type="button" onClick={() => onToolExclusionsChange(['server-a:ping'])}>
        Exclude ping
      </button>
    </>
  ),
}));

const { ParameterField } = await import('../ParameterField');

describe('ParameterField security component parameters', () => {
  it('renders dnsx record type multi-select parameters', () => {
    render(
      <ParameterField
        parameter={{
          id: 'recordTypes',
          label: 'Record Types',
          type: 'multi-select',
          options: [
            { label: 'A', value: 'A' },
            { label: 'CNAME', value: 'CNAME' },
          ],
        }}
        value={['A']}
        onChange={() => undefined}
        componentId="sentris.dnsx.run"
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'A' })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'CNAME' })).toBeDefined();
  });

  it('renders nuclei severity filter and timeout parameters', () => {
    render(
      <>
        <ParameterField
          parameter={{
            id: 'severityFilter',
            label: 'Severity Filter',
            type: 'multi-select',
            options: [
              { label: 'High', value: 'high' },
              { label: 'Critical', value: 'critical' },
            ],
          }}
          value={['high']}
          onChange={() => undefined}
          componentId="sentris.nuclei.scan"
        />
        <ParameterField
          parameter={{
            id: 'rateLimit',
            label: 'Rate Limit',
            type: 'number',
            min: 1,
            max: 500,
          }}
          value={10}
          onChange={() => undefined}
          componentId="sentris.nuclei.scan"
        />
      </>,
    );

    expect(screen.getByLabelText('High')).toBeDefined();
    expect(screen.getByDisplayValue('10')).toBeDefined();
  });

  it('renders subfinder timeout parameter as a number input', () => {
    render(
      <ParameterField
        parameter={{
          id: 'timeout',
          label: 'Timeout (minutes)',
          type: 'number',
          min: 1,
          max: 120,
        }}
        value={5}
        onChange={() => undefined}
        componentId="sentris.subfinder.run"
      />,
    );

    expect(screen.getByDisplayValue('5')).toBeDefined();
  });

  it('updates mcp.custom toolExclusions through onUpdateParameter', () => {
    const onChange = mock(() => undefined);
    const onUpdateParameter = mock(() => undefined);

    render(
      <ParameterField
        parameter={{
          id: 'toolExclusions',
          label: 'Enabled Tools',
          type: 'multi-select',
          default: [],
        }}
        value={[]}
        onChange={onChange}
        componentId="mcp.custom"
        parameters={{ enabledServers: ['server-a'] }}
        onUpdateParameter={onUpdateParameter}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Exclude ping' }));

    expect(onUpdateParameter).toHaveBeenCalledWith('toolExclusions', ['server-a:ping']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes mcp.custom useAllEnabled scope to the tool selector', () => {
    render(
      <ParameterField
        parameter={{
          id: 'toolExclusions',
          label: 'Enabled Tools',
          type: 'multi-select',
          default: [],
        }}
        value={[]}
        onChange={() => undefined}
        componentId="mcp.custom"
        parameters={{ enabledServers: [], useAllEnabled: true }}
      />,
    );

    expect(screen.getByText('All enabled mode')).toBeDefined();
  });
});
