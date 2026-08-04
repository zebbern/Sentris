import {
  LLM_PROVIDER_CATALOG,
  type OperatorActionView,
  type OperatorApprovalMode,
  type OperatorDirectCommand,
  type OperatorJourney,
  type OperatorSessionDetail,
} from '@sentris/shared';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { OperatorModelForm } from '@/features/operator/OperatorModelForm';
import { OperatorModeSelect } from '@/features/operator/OperatorModeSelect';
import { OperatorJourneyPipeline } from '@/features/operator/OperatorJourneyPipeline';
import { OperatorTimeline } from '@/features/operator/OperatorTimeline';
import { projectOperatorJourneyPipeline } from '@/features/operator/operatorJourneyPipelineProjector';
import {
  createDefaultOperatorModelDraft,
  draftToModelConfig,
  modelConfigToDraft,
  type OperatorModelDraft,
} from '@/features/operator/operatorModelDraft';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  getOperatorSessionLatestTurnError,
  operatorSessionHasActiveTurn,
  useCreateOperatorSession,
  useCreateOperatorTurn,
  useCancelOperatorTurn,
  useDecideOperatorAction,
  useOperatorSessionStream,
  useOperatorSessions,
  useOperatorWorkflowDrafts,
  useUpdateOperatorSession,
} from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/store/notificationStore';
import {
  createOperatorTurnFromHandoff,
  readOperatorTurnHandoff,
  type OperatorTurnHandoff,
} from '@/features/operator/operatorHandoff';

const SUGGESTED_PROMPTS = [
  'Show my workflows',
  'What are my most recent runs?',
  'Summarize the latest failed run',
  'Build a workflow that scans a domain and summarizes findings',
] as const;

function formatUpdatedAt(value: string): string {
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return 'recently';
  }
}

function SessionRail({
  sessionId,
  sessions,
  isLoading,
  unreadSessionIds,
}: {
  sessionId?: string;
  sessions: ReturnType<typeof useOperatorSessions>['data'];
  isLoading: boolean;
  unreadSessionIds: ReadonlySet<string>;
}) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border/70 bg-app-chrome/35 md:flex lg:w-64">
      <div className="flex h-10 items-center justify-between border-b border-border/60 px-3">
        <span className="text-xs font-semibold text-muted-foreground">Sessions</span>
        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
          <Link to="/operator" aria-label="New Operator session" title="New Operator session">
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Operator sessions">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))
          : null}
        {!isLoading && sessions?.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Your Operator conversations will appear here.
          </p>
        ) : null}
        {sessions?.map((session) => (
          <Link
            key={session.id}
            to={`/operator/${session.id}`}
            aria-current={session.id === sessionId ? 'page' : undefined}
            aria-label={`${session.title}${unreadSessionIds.has(session.id) ? ', unread activity' : ''}`}
            className={cn(
              'block rounded-md border border-transparent px-2.5 py-2 transition-colors',
              session.id === sessionId
                ? 'border-primary/25 bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{session.title}</span>
              {unreadSessionIds.has(session.id) ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              ) : null}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {formatUpdatedAt(session.updatedAt)}
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function MobileSessionPicker({
  sessionId,
  sessions,
  unreadSessionIds,
}: {
  sessionId?: string;
  sessions: ReturnType<typeof useOperatorSessions>['data'];
  unreadSessionIds: ReadonlySet<string>;
}) {
  const navigate = useNavigate();

  return (
    <div className="border-b border-border/60 p-2 md:hidden">
      <label className="relative block">
        <span className="sr-only">Operator session</span>
        <select
          className="h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-xs outline-none focus:ring-2 focus:ring-ring"
          value={sessionId ?? '__new__'}
          onChange={(event) =>
            navigate(
              event.target.value === '__new__' ? '/operator' : `/operator/${event.target.value}`,
            )
          }
        >
          <option value="__new__">New session</option>
          {sessions?.map((session) => (
            <option key={session.id} value={session.id}>
              {unreadSessionIds.has(session.id) ? `• ${session.title}` : session.title}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </label>
    </div>
  );
}

function NewOperatorSession({ handoff }: { handoff: OperatorTurnHandoff | null }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const createSession = useCreateOperatorSession();
  const [approvalMode, setApprovalMode] = useState<OperatorApprovalMode>('ask');
  const [model, setModel] = useState<OperatorModelDraft>(createDefaultOperatorModelDraft);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const modelConfig = draftToModelConfig(model);
    if (!modelConfig) {
      toast({
        title: 'Choose a stored credential',
        description: 'Operator resolves API keys from Secrets when a turn runs.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const session = await createSession.mutateAsync({ approvalMode, model: modelConfig });
      navigate(`/operator/${session.id}`, {
        replace: true,
        state: handoff ? { operatorHandoff: handoff } : null,
      });
    } catch (error) {
      toast({
        title: 'Could not create Operator session',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-8">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-xl rounded-xl border border-border/70 bg-card/60 p-5 shadow-sm md:p-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {handoff?.kind === 'improve_run'
                ? 'Set up Operator to improve this run'
                : 'Start an Operator session'}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {handoff?.kind === 'improve_run'
                ? 'Connect a model once; Operator will then inspect, improve, rerun, and compare this completed run.'
                : 'Connect a model, then ask Operator to inspect or run your existing workflows.'}
            </p>
          </div>
        </div>

        <OperatorModelForm value={model} onChange={setModel} disabled={createSession.isPending} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div>
            <p className="text-xs font-medium">Approval mode</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Ask mode pauses only consequential actions.
            </p>
          </div>
          <OperatorModeSelect
            value={approvalMode}
            onChange={setApprovalMode}
            disabled={createSession.isPending}
          />
        </div>

        <Button
          type="submit"
          className="mt-5 w-full gap-2"
          disabled={createSession.isPending || !draftToModelConfig(model)}
        >
          {createSession.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
          {handoff ? 'Create session and improve run' : 'Create session'}
        </Button>
      </form>
    </div>
  );
}

function SessionModelSettings({ session }: { session: OperatorSessionDetail }) {
  const { toast } = useToast();
  const updateSession = useUpdateOperatorSession();
  const [model, setModel] = useState<OperatorModelDraft>(() => modelConfigToDraft(session.model));
  const modelConfig = draftToModelConfig(model);
  const isDirty = modelConfig
    ? JSON.stringify(modelConfig) !== JSON.stringify(session.model)
    : false;

  const save = async () => {
    if (!modelConfig || !isDirty) return;
    try {
      await updateSession.mutateAsync({ sessionId: session.id, input: { model: modelConfig } });
      toast({ title: 'Operator model updated' });
    } catch (error) {
      toast({
        title: 'Could not update model',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <details className="group border-b border-border/60 bg-card/20">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-xs text-muted-foreground md:px-4">
        <Settings2 className="h-3.5 w-3.5" />
        <span>{LLM_PROVIDER_CATALOG[session.model.provider].label}</span>
        <span className="text-border">/</span>
        <span className="truncate font-mono text-[10px]">{session.model.modelId}</span>
        <span className="ml-auto flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Credential ready
        </span>
      </summary>
      <div className="border-t border-border/50 px-3 py-3 md:px-4">
        <div className="mx-auto max-w-2xl">
          <OperatorModelForm
            value={model}
            onChange={setModel}
            disabled={updateSession.isPending}
            compact
          />
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void save()}
              disabled={!modelConfig || !isDirty || updateSession.isPending}
            >
              {updateSession.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save model
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}

function ActiveSession({
  session,
  handoff,
  focusTurnId,
}: {
  session: OperatorSessionDetail;
  handoff: OperatorTurnHandoff | null;
  focusTurnId: string | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const createTurn = useCreateOperatorTurn();
  const cancelTurn = useCancelOperatorTurn();
  const decideAction = useDecideOperatorAction();
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedHandoffRef = useRef<string | null>(null);
  const focusedTurnRef = useRef<string | null>(null);
  const isActive = operatorSessionHasActiveTurn(session);
  const latestTurnError = getOperatorSessionLatestTurnError(session);
  const expectedWorkflowDraftCount = session.actions.filter(
    (action) => action.commandName === 'propose_workflow_draft' && action.status === 'succeeded',
  ).length;
  const workflowDraftsQuery = useOperatorWorkflowDrafts(
    session.id,
    isActive,
    expectedWorkflowDraftCount,
  );
  const journeyPipeline = projectOperatorJourneyPipeline(session);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [session.messages.length, session.actions.length, isActive]);

  useEffect(() => {
    if (!focusTurnId || focusedTurnRef.current === focusTurnId) return;
    const viewport = scrollRef.current;
    const target = Array.from(
      viewport?.querySelectorAll<HTMLElement>('[data-operator-turn-id]') ?? [],
    ).find((element) => element.dataset.operatorTurnId === focusTurnId);
    if (!target || typeof target.scrollIntoView !== 'function') return;
    focusedTurnRef.current = focusTurnId;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusTurnId, session.actions.length, session.messages.length]);

  const sendTurn = useCallback(
    async (
      content: string,
      directCommand?: OperatorDirectCommand,
      journey?: OperatorJourney,
      options?: { clientTurnId?: string; contextPath?: string },
    ) => {
      if (!content || isActive || createTurn.isPending) return;

      try {
        await createTurn.mutateAsync({
          sessionId: session.id,
          input: {
            clientTurnId: options?.clientTurnId ?? crypto.randomUUID(),
            message: content,
            context: { path: options?.contextPath ?? location.pathname },
            ...(directCommand ? { directCommand } : {}),
            ...(journey ? { journey } : {}),
          },
        });
        setMessage('');
      } catch (error) {
        toast({
          title: 'Could not send message',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
    [createTurn, isActive, location.pathname, session.id, toast],
  );

  useEffect(() => {
    if (
      !handoff ||
      isActive ||
      createTurn.isPending ||
      startedHandoffRef.current === handoff.clientTurnId
    ) {
      return;
    }

    startedHandoffRef.current = handoff.clientTurnId;
    const turn = createOperatorTurnFromHandoff(handoff);
    navigate(location.pathname, { replace: true, state: null });
    void sendTurn(turn.message, turn.directCommand, turn.journey, {
      clientTurnId: turn.clientTurnId,
      contextPath: turn.context?.path,
    });
  }, [createTurn.isPending, handoff, isActive, location.pathname, navigate, sendTurn]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    await sendTurn(message.trim());
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submit();
  };

  const decide = async (action: OperatorActionView, decision: 'approved' | 'rejected') => {
    try {
      await decideAction.mutateAsync({
        sessionId: session.id,
        actionId: action.id,
        input: { decision, expectedVersion: action.version },
      });
    } catch (error) {
      toast({
        title: `Could not ${decision === 'approved' ? 'approve' : 'reject'} action`,
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const cancel = async (turnId: string) => {
    try {
      await cancelTurn.mutateAsync({ sessionId: session.id, turnId });
    } catch (error) {
      toast({
        title: 'Could not stop Operator plan',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionModelSettings key={session.id} session={session} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
        <div className="mx-auto max-w-3xl">
          {journeyPipeline ? <OperatorJourneyPipeline pipeline={journeyPipeline} /> : null}
          <OperatorTimeline
            messages={session.messages}
            actions={session.actions}
            turns={session.turns}
            workflowDrafts={workflowDraftsQuery.data ?? []}
            isActive={isActive}
            pendingDecisionActionId={decideAction.variables?.actionId}
            runCommandDisabled={isActive || createTurn.isPending}
            onDecision={(action, decision) => void decide(action, decision)}
            onRunCommand={(request) =>
              void sendTurn(request.message, request.directCommand, request.journey)
            }
            pendingCancelTurnId={cancelTurn.variables?.turnId}
            onCancelTurn={(turnId) => void cancel(turnId)}
          />
          {latestTurnError ? <ErrorBanner message={latestTurnError} className="ml-9 mt-3" /> : null}
        </div>
      </div>

      <div className="border-t border-border/70 bg-app-chrome/55 px-3 py-3 backdrop-blur-sm md:px-5">
        <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-3xl">
          {session.messages.length === 0 ? (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="shrink-0 rounded-md border border-border/70 bg-background/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                  onClick={() => setMessage(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <div className="relative">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={isActive ? 'Operator is completing the current turn…' : 'Ask Operator…'}
              aria-label="Message Operator"
              className="min-h-[52px] resize-none rounded-lg pr-12 text-sm"
              disabled={isActive || createTurn.isPending}
              rows={2}
            />
            <Button
              type="submit"
              size="icon"
              className="absolute bottom-2 right-2 h-8 w-8"
              aria-label="Send message"
              disabled={!message.trim() || isActive || createTurn.isPending}
            >
              {createTurn.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}

export function OperatorPage() {
  useDocumentTitle('Operator');
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const notifications = useNotificationStore((state) => state.notifications);
  const markOperatorSessionRead = useNotificationStore((state) => state.markOperatorSessionRead);
  const handoff = readOperatorTurnHandoff(location.state);
  const sessionsQuery = useOperatorSessions();
  const sessionQuery = useOperatorSessionStream(sessionId);
  const latestSessionId = sessionsQuery.data?.[0]?.id;
  const focusTurnId = searchParams.get('turnId');
  const unreadSessionIds = useMemo(
    () =>
      new Set(
        notifications.flatMap((notification) =>
          !notification.read && notification.sessionId ? [notification.sessionId] : [],
        ),
      ),
    [notifications],
  );

  useEffect(() => {
    if (sessionId) markOperatorSessionRead(sessionId);
  }, [markOperatorSessionRead, sessionId]);

  useEffect(() => {
    if (sessionId || !handoff || !latestSessionId) return;
    navigate(`/operator/${latestSessionId}`, {
      replace: true,
      state: { operatorHandoff: handoff },
    });
  }, [handoff, latestSessionId, navigate, sessionId]);

  const isResolvingHandoff = Boolean(
    !sessionId && handoff && (sessionsQuery.isLoading || latestSessionId),
  );

  return (
    <div className="flex h-full min-h-[calc(100vh-2.5rem)] bg-background">
      <SessionRail
        sessionId={sessionId}
        sessions={sessionsQuery.data}
        isLoading={sessionsQuery.isLoading}
        unreadSessionIds={unreadSessionIds}
      />

      <section className="flex min-w-0 flex-1 flex-col" aria-busy={sessionQuery.isFetching}>
        <MobileSessionPicker
          sessionId={sessionId}
          sessions={sessionsQuery.data}
          unreadSessionIds={unreadSessionIds}
        />

        {!sessionId && !isResolvingHandoff ? <NewOperatorSession handoff={handoff} /> : null}

        {isResolvingHandoff ? (
          <div
            className="flex flex-1 items-center justify-center"
            aria-label="Opening Operator session"
          >
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {sessionId && sessionQuery.isLoading ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-4/5" />
            <Skeleton className="ml-auto h-16 w-3/5" />
          </div>
        ) : null}

        {sessionId && sessionQuery.error ? (
          <div className="mx-auto w-full max-w-xl px-4 py-8">
            <ErrorBanner
              message={sessionQuery.error.message || 'Could not load this Operator session'}
              onRetry={() => void sessionQuery.refetch()}
            />
            <Button asChild variant="link" className="mt-3 px-0">
              <Link to="/operator">Start a new session</Link>
            </Button>
          </div>
        ) : null}

        {sessionQuery.data ? (
          <ActiveSession session={sessionQuery.data} handoff={handoff} focusTurnId={focusTurnId} />
        ) : null}
      </section>
    </div>
  );
}
