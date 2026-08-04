import { useCallback, useState } from 'react';
import type { CreateMcpServer } from '@sentris/shared';

import { useToast } from '@/components/ui/use-toast';
import {
  useCreateMcpServer,
  useTestMcpConnection,
  useUpdateMcpServer,
} from '@/hooks/queries/useMcpServerQueries';
import type { ServerFormData } from './types';
import { INITIAL_FORM_DATA } from './types';
import { parseClaudeCodeConfig } from './utils';

interface UseJsonImportOptions {
  editingServer: string | null;
  formData: ServerFormData;
  setEditorOpen: (open: boolean) => void;
  setEditingServer: (id: string | null) => void;
  setFormData: (data: ServerFormData) => void;
  setCheckingServers: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useJsonImport({
  editingServer,
  formData,
  setEditorOpen,
  setEditingServer,
  setFormData,
  setCheckingServers,
}: UseJsonImportOptions) {
  const { toast } = useToast();
  const [jsonValue, setJsonValue] = useState('');
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const createServerMutation = useCreateMcpServer();
  const updateServerMutation = useUpdateMcpServer();
  const testConnectionMutation = useTestMcpConnection();

  const handleJsonSave = useCallback(async () => {
    const { servers: parsedServers, error } = parseClaudeCodeConfig(jsonValue);
    if (error) {
      setJsonParseError(error);
      return;
    }
    if (parsedServers.length === 0) {
      setJsonParseError('No servers found in config');
      return;
    }

    setIsImporting(true);
    setJsonParseError(null);

    if (editingServer) {
      try {
        const payload = serverConfigToPayload(parsedServers[0].config, {
          name: formData.name.trim(),
          enabled: formData.enabled,
        });
        await updateServerMutation.mutateAsync({ id: editingServer, input: payload });
        setCheckingServers((current) => new Set(current).add(editingServer));
        const discovery = await testConnectionMutation.mutateAsync(editingServer);
        if (!discovery.success) {
          setJsonParseError(`Configuration saved, but discovery failed: ${discovery.message}`);
          return;
        }

        toast({ title: 'Server ready', description: discovery.message });
        setEditorOpen(false);
        setEditingServer(null);
        setFormData(INITIAL_FORM_DATA);
      } catch (saveError: unknown) {
        setJsonParseError(
          saveError instanceof Error ? saveError.message : 'Failed to update and discover server',
        );
      } finally {
        setCheckingServers((current) => {
          const next = new Set(current);
          next.delete(editingServer);
          return next;
        });
        setIsImporting(false);
      }
      return;
    }

    let createdServerIds: string[] = [];
    try {
      const createResults = await Promise.allSettled(
        parsedServers.map(({ config }) =>
          createServerMutation.mutateAsync(serverConfigToPayload(config)),
        ),
      );
      type ServerResponse = Awaited<ReturnType<typeof createServerMutation.mutateAsync>>;
      const created = createResults
        .filter(
          (result): result is PromiseFulfilledResult<ServerResponse> =>
            result.status === 'fulfilled',
        )
        .map((result) => result.value);
      createdServerIds = created.map((server) => server.id);
      const createFailureCount = createResults.length - created.length;

      if (created.length === 0) {
        setJsonParseError('No servers were created. Review the configuration and try again.');
        toast({ title: 'Import failed', variant: 'destructive' });
        return;
      }

      setCheckingServers((current) => {
        const next = new Set(current);
        created.forEach((server) => next.add(server.id));
        return next;
      });

      const discoveryResults = await Promise.allSettled(
        created.map((server) => testConnectionMutation.mutateAsync(server.id)),
      );
      const readyCount = discoveryResults.filter(
        (result) => result.status === 'fulfilled' && result.value.success,
      ).length;
      const discoveryFailureCount = created.length - readyCount;

      toast({
        title: discoveryFailureCount === 0 ? 'Import complete' : 'Import needs attention',
        description:
          `${created.length} server(s) saved; ${readyCount} ready` +
          (discoveryFailureCount > 0 ? `, ${discoveryFailureCount} saved for correction` : '') +
          (createFailureCount > 0 ? `, ${createFailureCount} could not be created` : ''),
        variant: readyCount === 0 ? 'destructive' : 'default',
      });

      setEditorOpen(false);
      setJsonValue('');
    } catch (importError: unknown) {
      setJsonParseError(
        importError instanceof Error
          ? importError.message
          : 'Failed to import and discover servers',
      );
    } finally {
      setCheckingServers((current) => {
        const next = new Set(current);
        createdServerIds.forEach((serverId) => next.delete(serverId));
        return next;
      });
      setIsImporting(false);
    }
  }, [
    jsonValue,
    editingServer,
    formData.name,
    formData.enabled,
    createServerMutation,
    updateServerMutation,
    testConnectionMutation,
    toast,
    setCheckingServers,
    setEditorOpen,
    setEditingServer,
    setFormData,
  ]);

  return {
    jsonValue,
    setJsonValue,
    jsonParseError,
    setJsonParseError,
    isImporting,
    handleJsonSave,
  };
}

function serverConfigToPayload(
  config: ServerFormData,
  overrides?: Pick<CreateMcpServer, 'name' | 'enabled'>,
): CreateMcpServer {
  return {
    name: overrides?.name ?? config.name.trim(),
    description: config.description.trim() || undefined,
    transportType: config.transportType,
    endpoint: config.transportType === 'http' ? config.endpoint.trim() || undefined : undefined,
    command: config.transportType === 'stdio' ? config.command.trim() || undefined : undefined,
    args:
      config.transportType === 'stdio' && config.args.trim()
        ? config.args
            .split('\n')
            .map((argument) => argument.trim())
            .filter(Boolean)
        : undefined,
    headers: config.headers.trim() ? JSON.parse(config.headers) : undefined,
    enabled: overrides?.enabled ?? true,
  };
}
