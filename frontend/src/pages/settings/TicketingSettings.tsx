import { useState, useCallback, useMemo, useEffect } from 'react';
import { Loader2, ExternalLink, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { humanizeApiError } from '@/lib/humanizeApiError';
import {
  useTicketingConnection,
  useTicketingProjects,
  useTicketingIssueTypes,
  useConnectJiraMutation,
  useDisconnectJiraMutation,
  useUpdateTicketingConfigMutation,
} from '@/hooks/queries/useTicketingQueries';
import {
  DEFAULT_JIRA_STATUS_MAPPING,
  FINDING_TRIAGE_STATUSES,
  type FindingTriageStatus,
} from '@sentris/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  triaged: 'Triaged',
  in_progress: 'In Progress',
  fixed: 'Fixed',
  verified: 'Verified',
  wont_fix: "Won't Fix",
  accepted_risk: 'Accepted Risk',
};

const MAPPABLE_STATUSES = FINDING_TRIAGE_STATUSES.filter(
  (s): s is Exclude<FindingTriageStatus, 'new'> => s !== 'new',
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TicketingSettings() {
  useDocumentTitle('Settings · Ticketing');

  const { data: connection, isLoading, error } = useTicketingConnection();
  const isConnected = connection?.isConnected ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Jira Integration</h3>
        <p className="text-sm text-muted-foreground">
          Connect your Jira Cloud instance to automatically create and sync tickets from findings.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-48" />
        </div>
      )}

      {error && !isLoading && <ErrorBanner message={humanizeApiError(error)} />}

      {!isLoading && !error && connection && (
        <>
          <ConnectionStatusCard
            isConnected={isConnected}
            cloudId={connection.cloudId}
            createdAt={connection.createdAt}
          />
          {!isConnected && <ConnectButton />}
          {isConnected && (
            <>
              <DisconnectSection />
              <ConfigurationForm initialConfig={connection.config ?? undefined} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Status Card
// ---------------------------------------------------------------------------

function ConnectionStatusCard({
  isConnected,
  cloudId,
  createdAt,
}: {
  isConnected: boolean;
  cloudId: string | null;
  createdAt: string | null;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/30">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-blue-600 dark:text-blue-400"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53Zm-4.67 4.65c-.02 2.4 1.93 4.36 4.33 4.38h1.8v1.72c0 2.4 1.94 4.34 4.34 4.35V7.5a.84.84 0 0 0-.84-.84l-9.63-.01ZM2.24 11.33c0 2.4 1.95 4.35 4.35 4.35h1.78v1.72c0 2.4 1.94 4.34 4.34 4.35V12.17a.84.84 0 0 0-.84-.84H2.24Z" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">Jira Cloud</span>
          {isConnected ? (
            <Badge variant="default" className="bg-green-600 hover:bg-green-600 text-white text-xs">
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              Disconnected
            </Badge>
          )}
        </div>
        {isConnected && cloudId && (
          <p className="text-sm text-muted-foreground mt-0.5">
            Cloud ID: <span className="font-mono text-xs">{cloudId}</span>
          </p>
        )}
        {isConnected && createdAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Connected {new Date(createdAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect Button
// ---------------------------------------------------------------------------

function ConnectButton() {
  const connectMutation = useConnectJiraMutation();

  const handleConnect = useCallback(() => {
    const redirectUri = `${window.location.origin}/settings/ticketing/callback`;
    connectMutation.mutate(redirectUri, {
      onSuccess: (data) => {
        window.location.href = data.authorizationUrl;
      },
    });
  }, [connectMutation]);

  return (
    <Button onClick={handleConnect} disabled={connectMutation.isPending}>
      {connectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
      <ExternalLink className="h-4 w-4 mr-2" />
      Connect Jira
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Disconnect Section
// ---------------------------------------------------------------------------

function DisconnectSection() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const disconnectMutation = useDisconnectJiraMutation();

  const handleDisconnect = useCallback(() => {
    disconnectMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Jira disconnected', variant: 'success' });
        setIsDialogOpen(false);
      },
      onError: (err) => {
        toast({
          title: 'Failed to disconnect',
          description: humanizeApiError(err),
          variant: 'destructive',
        });
      },
    });
  }, [disconnectMutation, toast]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsDialogOpen(true)}
        className="text-destructive border-destructive/30 hover:bg-destructive/10"
      >
        <Unplug className="h-4 w-4 mr-2" />
        Disconnect Jira
      </Button>
      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Jira?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Jira connection and OAuth tokens. Existing linked tickets will be
              preserved but no new tickets will be created or synced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnectMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Configuration Form
// ---------------------------------------------------------------------------

interface FormConfig {
  projectKey: string;
  issueTypeId: string;
  statusMapping: Record<string, string>;
  autoCreateOnStatuses: string[];
}

function ConfigurationForm({ initialConfig }: { initialConfig?: FormConfig }) {
  const { toast } = useToast();
  const updateMutation = useUpdateTicketingConfigMutation();

  const [projectKey, setProjectKey] = useState(initialConfig?.projectKey ?? '');
  const [issueTypeId, setIssueTypeId] = useState(initialConfig?.issueTypeId ?? '');
  const [statusMapping, setStatusMapping] = useState<Record<string, string>>(
    initialConfig?.statusMapping ?? { ...DEFAULT_JIRA_STATUS_MAPPING },
  );
  const [autoCreate, setAutoCreate] = useState<string[]>(
    initialConfig?.autoCreateOnStatuses ?? ['triaged'],
  );

  useEffect(() => {
    if (initialConfig) {
      setProjectKey(initialConfig.projectKey);
      setIssueTypeId(initialConfig.issueTypeId);
      setStatusMapping(initialConfig.statusMapping);
      setAutoCreate(initialConfig.autoCreateOnStatuses);
    }
  }, [initialConfig]);

  const { data: projects, isLoading: loadingProjects } = useTicketingProjects(true);
  const { data: issueTypes, isLoading: loadingTypes } = useTicketingIssueTypes(
    projectKey || undefined,
  );

  const handleProjectChange = useCallback((key: string) => {
    setProjectKey(key);
    setIssueTypeId('');
  }, []);

  const isValid = useMemo(
    () =>
      projectKey.length > 0 &&
      issueTypeId.length > 0 &&
      autoCreate.length > 0 &&
      MAPPABLE_STATUSES.every((s) => (statusMapping[s] ?? '').trim().length > 0),
    [projectKey, issueTypeId, autoCreate, statusMapping],
  );

  const handleSave = useCallback(() => {
    if (!isValid) return;
    updateMutation.mutate(
      {
        projectKey,
        issueTypeId,
        statusMapping: statusMapping as Record<FindingTriageStatus, string>,
        autoCreateOnStatuses: autoCreate as FindingTriageStatus[],
      },
      {
        onSuccess: () => toast({ title: 'Configuration saved', variant: 'success' }),
        onError: (err) =>
          toast({
            title: 'Failed to save',
            description: humanizeApiError(err),
            variant: 'destructive',
          }),
      },
    );
  }, [isValid, projectKey, issueTypeId, statusMapping, autoCreate, updateMutation, toast]);

  return (
    <div className="space-y-6 rounded-lg border p-4">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Configuration
      </h4>

      {/* Project */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="jira-project">
          Project
        </label>
        <Select value={projectKey} onValueChange={handleProjectChange}>
          <SelectTrigger id="jira-project" className="w-full max-w-xs" aria-label="Jira project">
            {loadingProjects ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            ) : (
              <SelectValue placeholder="Select a project" />
            )}
          </SelectTrigger>
          <SelectContent>
            {projects?.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.key} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Issue Type */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="jira-type">
          Issue Type
        </label>
        <Select value={issueTypeId} onValueChange={setIssueTypeId} disabled={!projectKey}>
          <SelectTrigger id="jira-type" className="w-full max-w-xs" aria-label="Jira issue type">
            {loadingTypes && projectKey ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            ) : (
              <SelectValue
                placeholder={projectKey ? 'Select an issue type' : 'Select a project first'}
              />
            )}
          </SelectTrigger>
          <SelectContent>
            {issueTypes?.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  {t.iconUrl && (
                    <img src={t.iconUrl} alt="" className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Auto-create statuses */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Auto-create Ticket on Status</label>
        <p className="text-xs text-muted-foreground">
          A Jira ticket will be created when a finding transitions to one of these statuses.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MAPPABLE_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={autoCreate.includes(s)}
                onCheckedChange={(c) =>
                  setAutoCreate((prev) => (c ? [...prev, s] : prev.filter((x) => x !== s)))
                }
                aria-label={`Auto-create on ${STATUS_LABELS[s]}`}
              />
              {STATUS_LABELS[s] ?? s}
            </label>
          ))}
        </div>
      </div>

      {/* Status mapping */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Status Mapping</label>
        <p className="text-xs text-muted-foreground">
          Map each finding status to a Jira transition name.
        </p>
        <div className="rounded-md border">
          <div className="grid grid-cols-2 gap-px bg-muted text-xs font-medium uppercase tracking-wider">
            <div className="bg-background px-3 py-2">Finding Status</div>
            <div className="bg-background px-3 py-2">Jira Status</div>
          </div>
          {MAPPABLE_STATUSES.map((s) => (
            <div key={s} className="grid grid-cols-2 gap-px border-t bg-muted">
              <div className="bg-background px-3 py-2 text-sm flex items-center">
                {STATUS_LABELS[s] ?? s}
              </div>
              <div className="bg-background px-3 py-1">
                <Input
                  value={statusMapping[s] ?? ''}
                  onChange={(e) => setStatusMapping((prev) => ({ ...prev, [s]: e.target.value }))}
                  placeholder="Jira transition name"
                  className="h-8 text-sm border-0 shadow-none focus-visible:ring-1"
                  aria-label={`Jira status for ${STATUS_LABELS[s]}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!isValid || updateMutation.isPending}>
          {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Configuration
        </Button>
      </div>
    </div>
  );
}
