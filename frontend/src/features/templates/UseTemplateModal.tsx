import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { useUseTemplate, type Template } from '@/hooks/queries/useTemplateQueries';
import { useSecrets } from '@/hooks/queries/useSecretQueries';
import { useComponents } from '@/hooks/queries/useComponentQueries';
import { useMcpAllTools, useMcpServers } from '@/hooks/queries/useMcpServerQueries';
import { ReadinessSummary } from '@/features/agent-readiness/ReadinessSummary';
import {
  evaluateTemplateLaunchReadiness,
  parseTemplateLaunchRequirements,
} from './template-launch-readiness';
import { Link } from 'react-router-dom';

interface UseTemplateModalProps {
  template: Template;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (workflowId: string) => void;
}

export function UseTemplateModal({
  template,
  open,
  onOpenChange,
  onSuccess,
}: UseTemplateModalProps) {
  const useTemplateMutation = useUseTemplate();
  const isLoading = useTemplateMutation.isPending;
  const requiredSecrets = template.requiredSecrets || [];
  const componentsQuery = useComponents();
  const requirements = useMemo(() => {
    const index = componentsQuery.data;
    if (!index) return { models: [], mcp: [] };
    return parseTemplateLaunchRequirements(template.graph, (ref) => {
      const direct = index.byId[ref];
      if (direct) return direct;
      const id = index.slugIndex[ref];
      return id ? (index.byId[id] ?? null) : null;
    });
  }, [componentsQuery.data, template.graph]);
  const needsMcp = open && requirements.mcp.length > 0;
  const {
    data: availableSecrets = [],
    isLoading: isLoadingSecrets,
    error: secretsError,
  } = useSecrets({ enabled: open && requiredSecrets.length > 0 });
  const {
    data: mcpServers = [],
    isLoading: isLoadingMcpServers,
    error: mcpServersError,
  } = useMcpServers({ enabled: needsMcp });
  const {
    data: mcpTools = [],
    isLoading: isLoadingMcpTools,
    error: mcpToolsError,
  } = useMcpAllTools({ enabled: needsMcp });

  const [workflowName, setWorkflowName] = useState(template.name);
  const [secretMappings, setSecretMappings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const requiredSecretNames = useMemo(
    () => requiredSecrets.map((secret) => secret.name),
    [requiredSecrets],
  );
  const hasUnmappedSecrets = useMemo(
    () => requiredSecretNames.some((name) => !secretMappings[name]),
    [requiredSecretNames, secretMappings],
  );
  const readinessRows = useMemo(
    () =>
      evaluateTemplateLaunchReadiness({
        requirements,
        requiredSecretNames,
        secretMappings,
        secrets: {
          items: availableSecrets,
          isLoading: isLoadingSecrets,
          error: secretsError ?? null,
        },
        mcpServers: {
          items: mcpServers,
          isLoading: isLoadingMcpServers,
          error: mcpServersError ?? null,
        },
        mcpTools: {
          items: mcpTools,
          isLoading: isLoadingMcpTools,
          error: mcpToolsError ?? null,
        },
        componentCatalog: {
          isLoading: componentsQuery.isLoading,
          error: componentsQuery.error ?? null,
        },
      }),
    [
      availableSecrets,
      componentsQuery.error,
      componentsQuery.isLoading,
      isLoadingMcpServers,
      isLoadingMcpTools,
      isLoadingSecrets,
      mcpServers,
      mcpServersError,
      mcpTools,
      mcpToolsError,
      requiredSecretNames,
      requirements,
      secretMappings,
      secretsError,
    ],
  );
  const displayReadinessRows = useMemo(
    () =>
      readinessRows.map((row) => {
        if (row.kind !== 'credential') return row;
        if (requiredSecrets.length === 0)
          return { ...row, label: 'Credentials', detail: 'Not required' };
        const mappedCount = requiredSecretNames.filter((name) =>
          Boolean(secretMappings[name]),
        ).length;
        return {
          ...row,
          label: 'Credentials',
          detail:
            row.state === 'ready'
              ? `${mappedCount}/${requiredSecrets.length} mapped`
              : 'Needs mapping',
        };
      }),
    [readinessRows, requiredSecretNames, requiredSecrets.length, secretMappings],
  );
  const blocksCreation = readinessRows.some((row) => row.blocksCreation);

  // Reset state when template or open changes to avoid stale data (#3)
  useEffect(() => {
    if (open) {
      setWorkflowName(template.name);
      setSecretMappings({});
      setError(null);
    }
  }, [template.id, template.name, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!workflowName.trim()) {
      setError('Please enter a workflow name');
      return;
    }

    // Check if all required secrets have mappings
    const unmappedSecrets = requiredSecrets.filter((secret) => !secretMappings[secret.name]);

    if (unmappedSecrets.length > 0) {
      setError(
        `Select an existing Sentris secret for each required credential: ${unmappedSecrets.map((s) => s.name).join(', ')}`,
      );
      return;
    }

    try {
      const result = await useTemplateMutation.mutateAsync({
        templateId: template.id,
        workflowName: workflowName.trim(),
        secretMappings: requiredSecrets.length > 0 ? secretMappings : undefined,
      });
      onSuccess(result.workflow?.id ?? result.workflowId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workflow from template');
    }
  };

  const handleSecretMappingChange = (secretName: string, value: string) => {
    setSecretMappings((prev) => ({
      ...prev,
      [secretName]: value,
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure &amp; Run: {template.name}</DialogTitle>
          <DialogDescription>
            Create the workflow, map any stored credentials, then continue straight to its run
            setup.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Workflow Name */}
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Workflow Name</Label>
            <Input
              id="workflow-name"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder="Enter workflow name"
            />
          </div>

          {/* Template Info */}
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Category:</span>
              <Badge variant="outline">{template.category || 'Uncategorized'}</Badge>
            </div>
            {template.description && (
              <p className="text-sm text-muted-foreground">{template.description}</p>
            )}
            {template.tags && template.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Required Secrets */}
          {requiredSecrets.length > 0 ? (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Required Secrets ({requiredSecrets.length})
              </Label>

              {isLoadingSecrets ? (
                <p className="text-sm text-muted-foreground">Loading Sentris secrets…</p>
              ) : secretsError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  Could not load secrets. Try again from the Secrets page.
                </div>
              ) : availableSecrets.length === 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-sm font-medium">No stored secrets are available.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add the credentials once in Sentris, then return here to map them safely.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link to="/secrets">Open secret settings</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {requiredSecrets.map((secret) => (
                    <div key={secret.name} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`secret-${secret.name}`} className="text-sm">
                          {secret.name}
                        </Label>
                        <Badge variant="outline" className="text-xs">
                          {secret.type}
                        </Badge>
                      </div>
                      {secret.description && (
                        <p className="text-xs text-muted-foreground">{secret.description}</p>
                      )}
                      <select
                        id={`secret-${secret.name}`}
                        value={secretMappings[secret.name] || ''}
                        onChange={(e) => handleSecretMappingChange(secret.name, e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Select an existing Sentris secret</option>
                        {availableSecrets.map((availableSecret) => (
                          <option key={availableSecret.id} value={availableSecret.id}>
                            {availableSecret.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Only secret references are saved in the workflow. Credential values remain in the
                Sentris secret store.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">
                This template doesn&apos;t require any secrets. You can customize the workflow after
                creating it.
              </p>
            </div>
          )}

          <section className="space-y-2" aria-labelledby="run-readiness-heading">
            <h3 id="run-readiness-heading" className="text-sm font-medium">
              Run readiness
            </h3>
            <ReadinessSummary rows={displayReadinessRows} />
            {requirements.mcp.length > 0 && (
              <Link
                to="/mcp-library"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Manage MCP servers in the MCP library
              </Link>
            )}
            <p aria-live="polite" aria-atomic="true" className="sr-only">
              Run readiness.{' '}
              {displayReadinessRows.map((row) => `${row.label}: ${row.detail}`).join(' ')}
            </p>
          </section>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/50">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || hasUnmappedSecrets || blocksCreation}
              className="gap-2"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create &amp; Run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
