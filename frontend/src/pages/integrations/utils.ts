import type { components } from '@shipsec/backend-client';

export type IntegrationProvider = components['schemas']['IntegrationProviderResponse'];
export type IntegrationConnection = components['schemas']['IntegrationConnectionResponse'];

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch (error) {
    console.error('Failed to format timestamp', error);
    return iso;
  }
}

export function getProviderConnection(
  providerId: string,
  connectionMap: Map<string, IntegrationConnection>,
): IntegrationConnection | undefined {
  return connectionMap.get(providerId);
}
