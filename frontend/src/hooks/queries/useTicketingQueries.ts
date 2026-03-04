import { useQuery, useMutation, useQueryClient, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { queryKeys } from '@/lib/queryKeys';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch org Jira connection status. */
export function useTicketingConnection() {
  return useQuery({
    queryKey: queryKeys.ticketing.connection(),
    queryFn: () => api.ticketing.getConnectionStatus(),
    staleTime: 30_000,
  });
}

/** List Jira projects — enabled only when connected. */
export function useTicketingProjects(enabled = true) {
  return useQuery({
    queryKey: queryKeys.ticketing.projects(),
    queryFn: enabled ? () => api.ticketing.getProjects() : skipToken,
    staleTime: Infinity,
  });
}

/** List issue types for a Jira project — uses skipToken when no projectKey. */
export function useTicketingIssueTypes(projectKey: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ticketing.issueTypes(projectKey ?? ''),
    queryFn: projectKey ? () => api.ticketing.getIssueTypes(projectKey) : skipToken,
    staleTime: Infinity,
  });
}

/** Get linked ticket for a finding. */
export function useFindingTicket(findingId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.ticketing.findingTicket(findingId ?? ''),
    queryFn: findingId ? () => api.ticketing.getFindingTicket(findingId) : skipToken,
    staleTime: 30_000,
    retry: false, // 404 simply means no ticket linked
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Initiate Jira OAuth connect — returns authorizationUrl. */
export function useConnectJiraMutation() {
  return useMutation({
    mutationFn: (redirectUri: string) => api.ticketing.connect(redirectUri),
  });
}

/** Disconnect Jira — invalidates connection query on success. */
export function useDisconnectJiraMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.ticketing.disconnect(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ticketing.connection() });
      qc.removeQueries({ queryKey: queryKeys.ticketing.projects() });
      qc.removeQueries({ queryKey: ['ticketing'] });
    },
  });
}

/** Update ticketing config (project, issue type, status mapping). */
export function useUpdateTicketingConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Parameters<typeof api.ticketing.configure>[0]) =>
      api.ticketing.configure(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ticketing.connection() });
    },
  });
}

/** Exchange OAuth callback code+state. */
export function useTicketingCallbackMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, state }: { code: string; state: string }) =>
      api.ticketing.handleCallback(code, state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ticketing.connection() });
    },
  });
}
