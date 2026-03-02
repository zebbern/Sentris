import { useCallback, useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Import, Loader2, Server, AlertTriangle } from 'lucide-react';
import {
  useRegistryCatalogDetail,
  useImportRegistryServer,
} from '@/hooks/queries/useMcpRegistryQueries';
import { useMcpGroupsWithServers } from '@/hooks/queries/useMcpGroupQueries';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface RegistryImportSheetProps {
  serverName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegistryImportSheet({ serverName, open, onOpenChange }: RegistryImportSheetProps) {
  const { data: server, isLoading } = useRegistryCatalogDetail(serverName);
  const { data: groups = [] } = useMcpGroupsWithServers();
  const importMutation = useImportRegistryServer();

  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [groupId, setGroupId] = useState<string>('');
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());

  // Reset form when sheet opens with a new server
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        setSecrets({});
        setEnvVars({});
        setEnabled(true);
        setGroupId('');
        setValidationErrors(new Set());
        importMutation.reset();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, importMutation],
  );

  const requiredSecretEnvKeys = useMemo(() => {
    if (!server) return [];
    // All listed secrets are required (shared schema has no `required` field)
    return server.configRequirements.secrets.map((s) => s.env);
  }, [server]);

  const isFormValid = useMemo(() => {
    return requiredSecretEnvKeys.every((envKey) => secrets[envKey]?.trim());
  }, [requiredSecretEnvKeys, secrets]);

  const handleSubmit = useCallback(() => {
    if (!server) return;

    // Validate required secrets
    const missing = new Set<string>();
    for (const envKey of requiredSecretEnvKeys) {
      if (!secrets[envKey]?.trim()) {
        missing.add(envKey);
      }
    }
    if (missing.size > 0) {
      setValidationErrors(missing);
      return;
    }

    setValidationErrors(new Set());
    importMutation.mutate(
      {
        registryName: server.name,
        secrets,
        envVars,
        enabled,
        groupId: groupId || undefined,
      },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
      },
    );
  }, [
    server,
    secrets,
    envVars,
    enabled,
    groupId,
    requiredSecretEnvKeys,
    importMutation,
    handleOpenChange,
  ]);

  const isConflict =
    importMutation.error && (importMutation.error as Error & { status?: number }).status === 409;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
        {!server && (
          <SheetHeader className="sr-only">
            <SheetTitle>Import Server</SheetTitle>
            <SheetDescription>Configure and import an MCP server</SheetDescription>
          </SheetHeader>
        )}

        {isLoading && (
          <div className="space-y-4 py-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {server && (
          <>
            <SheetHeader className="pb-4">
              <div className="flex items-start gap-3">
                {server.iconUrl ? (
                  <img
                    src={server.iconUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="rounded-lg object-contain shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Server className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <SheetTitle>Import {server.displayName}</SheetTitle>
                  <SheetDescription className="mt-1 line-clamp-2">
                    {server.description}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 py-4">
              {/* Conflict error */}
              {isConflict && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  This server is already imported in your library.
                </div>
              )}

              {/* Secrets */}
              {server.configRequirements.secrets.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Secrets</h4>
                  {server.configRequirements.secrets.map((secret) => {
                    const hasError = validationErrors.has(secret.env);
                    const descId = `desc-${secret.env}`;
                    const errorId = `error-${secret.env}`;
                    const describedBy =
                      [secret.example ? descId : null, hasError ? errorId : null]
                        .filter(Boolean)
                        .join(' ') || undefined;

                    return (
                      <div key={secret.env} className="space-y-1.5">
                        <Label htmlFor={`secret-${secret.env}`} className="flex items-center gap-1">
                          {secret.name}
                          <span className="text-destructive" aria-label="required">
                            *
                          </span>
                        </Label>
                        {secret.example && (
                          <p id={descId} className="text-xs text-muted-foreground">
                            Example: {secret.example}
                          </p>
                        )}
                        <Input
                          id={`secret-${secret.env}`}
                          type="password"
                          placeholder={secret.example || `Enter ${secret.name}`}
                          value={secrets[secret.env] ?? ''}
                          onChange={(e) =>
                            setSecrets((prev) => ({ ...prev, [secret.env]: e.target.value }))
                          }
                          aria-invalid={hasError}
                          aria-required="true"
                          aria-describedby={describedBy}
                          className={hasError ? 'border-destructive' : ''}
                        />
                        {hasError && (
                          <p id={errorId} className="text-xs text-destructive">
                            This field is required.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Environment Variables */}
              {server.configRequirements.env.length > 0 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Environment Variables</h4>
                  {server.configRequirements.env.map((envVar) => (
                    <div key={envVar.name} className="space-y-1.5">
                      <Label htmlFor={`env-${envVar.name}`} className="flex items-center gap-1">
                        {envVar.name}
                      </Label>
                      {envVar.example && (
                        <p className="text-xs text-muted-foreground">Example: {envVar.example}</p>
                      )}
                      <Input
                        id={`env-${envVar.name}`}
                        type="text"
                        placeholder={envVar.value || envVar.example || `Enter ${envVar.name}`}
                        value={envVars[envVar.name] ?? envVar.value ?? ''}
                        onChange={(e) =>
                          setEnvVars((prev) => ({ ...prev, [envVar.name]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* OAuth notice */}
              {server.oauthProviders.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    This server uses OAuth. Manual configuration may be required after import.
                  </span>
                </div>
              )}

              {/* Group selector */}
              {groups.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="import-group">Group (optional)</Label>
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger id="import-group">
                      <SelectValue placeholder="No group" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No group</SelectItem>
                      {groups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="import-enabled" className="cursor-pointer">
                  Enable server after import
                </Label>
                <Switch id="import-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>

            <SheetFooter className="pt-4">
              <div className="w-full">
                <Button
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={importMutation.isPending || !isFormValid}
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Import className="h-4 w-4 mr-2" />
                      Import Server
                    </>
                  )}
                </Button>
                <span role="status" aria-live="polite" className="sr-only">
                  {importMutation.isPending ? 'Importing server...' : ''}
                </span>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
