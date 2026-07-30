import { beforeEach, describe, expect, it, mock } from 'bun:test';

const listIntegrationConnections = mock(() => Promise.resolve({ data: [], error: undefined }));
const refreshIntegrationConnection = mock(() =>
  Promise.resolve({
    data: {
      id: 'connection-1',
      provider: 'github',
      providerName: 'GitHub',
      userId: 'authenticated-user',
      status: 'active',
      scopes: [],
      expiresAt: null,
      hasRefreshToken: true,
      supportsRefresh: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    error: undefined,
  }),
);
const disconnectIntegrationConnection = mock(() =>
  Promise.resolve({ data: undefined, error: undefined }),
);

mock.module('@/services/api/client', () => ({
  apiClient: {
    listIntegrationConnections,
    refreshIntegrationConnection,
    disconnectIntegrationConnection,
  },
}));

import { integrationsApi } from '../integrations';

beforeEach(() => {
  listIntegrationConnections.mockClear();
  refreshIntegrationConnection.mockClear();
  disconnectIntegrationConnection.mockClear();
});

describe('integrationsApi authenticated ownership', () => {
  it('lists connections without a client-selected user', async () => {
    await integrationsApi.listConnections();

    expect(listIntegrationConnections).toHaveBeenCalledWith();
  });

  it('refreshes a connection without a client-selected user', async () => {
    await integrationsApi.refreshConnection('connection-1');

    expect(refreshIntegrationConnection).toHaveBeenCalledWith('connection-1');
  });

  it('disconnects a connection without a client-selected user', async () => {
    await integrationsApi.disconnect('connection-1');

    expect(disconnectIntegrationConnection).toHaveBeenCalledWith('connection-1');
  });
});
