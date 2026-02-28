import type { components } from '@shipsec/backend-client';
import { apiClient } from './client';

type IntegrationProviderResponse = components['schemas']['IntegrationProviderResponse'];
type IntegrationConnectionResponse = components['schemas']['IntegrationConnectionResponse'];
type ProviderConfigurationResponse = components['schemas']['ProviderConfigurationResponse'];
type OAuthStartResponseDto = components['schemas']['OAuthStartResponseDto'];
type StartOAuthRequest = components['schemas']['StartOAuthDto'];
type CompleteOAuthRequest = components['schemas']['CompleteOAuthDto'];
type RefreshConnectionRequest = components['schemas']['RefreshConnectionDto'];
type DisconnectConnectionRequest = components['schemas']['DisconnectConnectionDto'];
type UpsertProviderConfigRequest = components['schemas']['UpsertProviderConfigDto'];

export type IntegrationProvider = IntegrationProviderResponse;
export type IntegrationConnection = IntegrationConnectionResponse;
export type IntegrationProviderConfiguration = ProviderConfigurationResponse;
export type OAuthStartResponse = OAuthStartResponseDto;

export const integrationsApi = {
  listProviders: async (): Promise<IntegrationProvider[]> => {
    const response = await apiClient.listIntegrationProviders();
    if (response.error) throw new Error('Failed to load providers');
    return (response.data ?? []) as IntegrationProvider[];
  },

  listConnections: async (userId: string): Promise<IntegrationConnection[]> => {
    const response = await apiClient.listIntegrationConnections(userId);
    if (response.error) throw new Error('Failed to load integrations');
    return (response.data ?? []) as IntegrationConnection[];
  },

  startOAuth: async (
    providerId: string,
    payload: StartOAuthRequest,
  ): Promise<OAuthStartResponse> => {
    const response = await apiClient.startIntegrationOAuth(providerId, payload);
    if (response.error || !response.data) throw new Error('Failed to start OAuth flow');
    return response.data;
  },

  completeOAuth: async (
    providerId: string,
    payload: CompleteOAuthRequest,
  ): Promise<IntegrationConnection> => {
    const response = await apiClient.completeIntegrationOAuth(providerId, payload);
    if (response.error || !response.data) throw new Error('Failed to complete OAuth exchange');
    return response.data;
  },

  refreshConnection: async (id: string, userId: string): Promise<IntegrationConnection> => {
    const payload: RefreshConnectionRequest = { userId };
    const response = await apiClient.refreshIntegrationConnection(id, payload);
    if (response.error || !response.data) {
      throw new Error('Failed to refresh integration connection');
    }
    return response.data;
  },

  disconnect: async (id: string, userId: string): Promise<void> => {
    const payload: DisconnectConnectionRequest = { userId };
    const response = await apiClient.disconnectIntegrationConnection(id, payload);
    if (response.error) throw new Error('Failed to disconnect integration');
  },

  getProviderConfig: async (providerId: string): Promise<IntegrationProviderConfiguration> => {
    const response = await apiClient.getIntegrationProviderConfiguration(providerId);
    if (response.error || !response.data) {
      throw new Error('Failed to load provider configuration');
    }
    return response.data;
  },

  upsertProviderConfig: async (
    providerId: string,
    payload: UpsertProviderConfigRequest,
  ): Promise<IntegrationProviderConfiguration> => {
    const response = await apiClient.upsertIntegrationProviderConfiguration(providerId, payload);
    if (response.error || !response.data) {
      throw new Error('Failed to save provider configuration');
    }
    return response.data;
  },

  deleteProviderConfig: async (providerId: string): Promise<void> => {
    const response = await apiClient.deleteIntegrationProviderConfiguration(providerId);
    if (response.error) throw new Error('Failed to remove provider configuration');
  },
};
