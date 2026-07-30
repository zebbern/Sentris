import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { McpServerResponse, McpToolResponse } from '@/hooks/queries/useMcpServerQueries';
import { renderWithProviders } from '@/test/render-with-providers';

const queryState: {
  servers: McpServerResponse[];
  tools: McpToolResponse[];
} = {
  servers: [],
  tools: [],
};

mock.module('@/hooks/queries/useMcpServerQueries', () => ({
  useMcpServers: () => ({
    data: queryState.servers,
    isLoading: false,
    error: null,
  }),
  useMcpAllTools: () => ({
    data: queryState.tools,
    isLoading: false,
    error: null,
  }),
}));

const { McpLibraryToolSelector } = await import('../McpLibraryToolSelector');

function server(id: string, name: string, enabled = true): McpServerResponse {
  return {
    id,
    name,
    description: null,
    transportType: 'http',
    endpoint: `https://${id}.example.test/mcp`,
    command: null,
    args: null,
    hasHeaders: false,
    headerKeys: null,
    enabled,
    healthCheckUrl: null,
    lastHealthCheck: null,
    lastHealthStatus: 'healthy',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    groupId: null,
  };
}

function tool(
  id: string,
  serverId: string,
  serverName: string,
  toolName: string,
  enabled = true,
): McpToolResponse {
  return {
    id,
    toolName,
    description: `${toolName} description`,
    inputSchema: { type: 'object', properties: {} },
    serverId,
    serverName,
    enabled,
    discoveredAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('McpLibraryToolSelector', () => {
  beforeEach(() => {
    queryState.servers = [
      server('server-a', 'Server A'),
      server('server-b', 'Server B'),
      server('server-disabled', 'Disabled Server', false),
    ];
    queryState.tools = [
      tool('a-ping', 'server-a', 'Server A', 'ping'),
      tool('a-admin', 'server-a', 'Server A', 'admin', false),
      tool('b-ping', 'server-b', 'Server B', 'ping'),
    ];
  });

  afterEach(() => cleanup());

  it('renders only selected servers that are globally enabled', () => {
    renderWithProviders(
      <McpLibraryToolSelector
        selectedServerIds={['server-a', 'server-disabled']}
        toolExclusions={[]}
        onToolExclusionsChange={() => undefined}
      />,
    );

    expect(screen.getByText('Server A')).toBeDefined();
    expect(screen.queryByText('Server B')).toBeNull();
    expect(screen.queryByText('Disabled Server')).toBeNull();
  });

  it('shows globally disabled tools but prevents workflow interaction', () => {
    renderWithProviders(
      <McpLibraryToolSelector
        selectedServerIds={['server-a']}
        toolExclusions={[]}
        onToolExclusionsChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show tools for Server A' }));

    expect(screen.getByText('admin')).toBeDefined();
    expect(screen.getByText('Globally disabled')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'admin on Server A' })).toBeDisabled();
  });

  it('uses server-qualified exclusion keys and keeps same-name tools independent', () => {
    const onToolExclusionsChange = mock(() => undefined);
    const { rerender } = renderWithProviders(
      <McpLibraryToolSelector
        selectedServerIds={['server-a', 'server-b']}
        toolExclusions={[]}
        onToolExclusionsChange={onToolExclusionsChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show tools for Server A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'ping on Server A' }));
    expect(onToolExclusionsChange).toHaveBeenLastCalledWith(['server-a:ping']);

    rerender(
      <McpLibraryToolSelector
        selectedServerIds={['server-a', 'server-b']}
        toolExclusions={['server-a:ping']}
        onToolExclusionsChange={onToolExclusionsChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show tools for Server B' }));

    expect(screen.getByRole('checkbox', { name: 'ping on Server A' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ping on Server B' })).toBeChecked();
  });

  it('shows the final globally enabled and workflow-included tool count', () => {
    renderWithProviders(
      <McpLibraryToolSelector
        selectedServerIds={['server-a', 'server-b']}
        toolExclusions={['server-a:ping']}
        onToolExclusionsChange={() => undefined}
      />,
    );

    expect(screen.getByText('1 tool enabled')).toBeDefined();
  });
});
