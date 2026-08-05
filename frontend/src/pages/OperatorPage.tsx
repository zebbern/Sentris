import {
  OperatorPlanProposalResultSchema,
  type OperatorActionView,
  type OperatorApprovalMode,
  type OperatorDirectCommand,
  type OperatorJourney,
  type OperatorRouteContext,
  type OperatorSessionDetail,
  type OperatorSessionSummary,
  type OperatorUserInputResponse,
} from '@sentris/shared';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Bot,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { OperatorModelForm } from '@/features/operator/OperatorModelForm';
import { OperatorModeSelect } from '@/features/operator/OperatorModeSelect';
import { OperatorSessionModelPicker } from '@/features/operator/OperatorSessionModelPicker';
import { OperatorJourneyPipeline } from '@/features/operator/OperatorJourneyPipeline';
import { OperatorTimeline } from '@/features/operator/OperatorTimeline';
import { OPERATOR_COMMAND_LABELS } from '@/features/operator/operatorCommandLabels';
import {
  OperatorWorkflowRunDialog,
  type OperatorWorkflowRunSelection,
} from '@/features/operator/OperatorWorkflowRunDialog';
import { projectOperatorJourneyPipeline } from '@/features/operator/operatorJourneyPipelineProjector';
import {
  createDefaultOperatorModelDraft,
  draftToModelConfig,
  type OperatorModelDraft,
} from '@/features/operator/operatorModelDraft';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import {
  getOperatorSessionLatestTurnError,
  operatorSessionHasActiveTurn,
  operatorSessionSummaryHasActiveTurn,
  useCreateOperatorSession,
  useCreateOperatorTurn,
  useCancelOperatorTurn,
  useDecideOperatorAction,
  useDeleteOperatorSession,
  useOperatorSessionStream,
  useOperatorSessions,
  useOperatorWorkflowDrafts,
  useUpdateOperatorSession,
} from '@/hooks/queries/useOperatorQueries';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/store/notificationStore';
import {
  createOperatorWorkflowDraftRevisionNavigationState,
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

const ACTIVE_TURN_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);
const SETTLED_ACTION_STATUSES = new Set(['succeeded', 'failed', 'rejected']);

interface ComposerActivity {
  turnId: string;
  label: string;
  stepLabel?: string;
  progress?: number;
  waitingForUser: boolean;
}

function getComposerActivity(session: OperatorSessionDetail): ComposerActivity | null {
  const turn = [...session.turns]
    .reverse()
    .find((candidate) => ACTIVE_TURN_STATUSES.has(candidate.status));
  if (!turn) return null;

  const actions = session.actions.filter((action) => action.turnId === turn.id);
  const currentAction = [...actions]
    .reverse()
    .find((action) => !SETTLED_ACTION_STATUSES.has(action.status));
  const waitingForUser =
    turn.status === 'awaiting_approval' && currentAction?.status === 'pending_approval';
  const label = waitingForUser
    ? currentAction?.commandName === 'request_user_input'
      ? 'Waiting for your answer'
      : 'Waiting for approval'
    : currentAction
      ? `${OPERATOR_COMMAND_LABELS[currentAction.commandName]}…`
      : turn.status === 'queued'
        ? 'Operator is queued…'
        : 'Operator is thinking…';

  if (turn.journey?.kind !== 'execute_plan') {
    return { turnId: turn.id, label, waitingForUser };
  }

  const planActionId = turn.journey.planActionId;
  const planAction = session.actions.find(
    (action) => action.id === planActionId && action.status === 'succeeded',
  );
  const plan = OperatorPlanProposalResultSchema.safeParse(planAction?.result);
  if (!plan.success) return { turnId: turn.id, label, waitingForUser };

  const planActions = actions.filter((action) =>
    action.toolCallId.includes(`:plan:${plan.data.planId}:`),
  );
  const settled = planActions.filter((action) => SETTLED_ACTION_STATUSES.has(action.status)).length;
  const currentStep = Math.min(plan.data.steps.length, settled + 1);
  return {
    turnId: turn.id,
    label,
    stepLabel: `Step ${Math.max(1, currentStep)} / ${plan.data.steps.length}`,
    progress: Math.max(4, (settled / plan.data.steps.length) * 100),
    waitingForUser,
  };
}

function formatUpdatedAt(value: string): string {
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return 'recently';
  }
}

function DeleteSessionButton({
  session,
  deletingSessionId,
  onDeleteSession,
  className,
  iconClassName,
}: {
  session: OperatorSessionSummary;
  deletingSessionId: string | null;
  onDeleteSession: (session: OperatorSessionSummary) => void;
  className: string;
  iconClassName: string;
}) {
  const hasActiveTurn = operatorSessionSummaryHasActiveTurn(session);
  const isDeleting = deletingSessionId === session.id;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      aria-label={`Delete chat: ${session.title}`}
      title={
        hasActiveTurn
          ? 'Stop or wait for the active turn before deleting this chat'
          : `Delete ${session.title}`
      }
      disabled={deletingSessionId !== null}
      onClick={() => onDeleteSession(session)}
    >
      {isDeleting ? (
        <Loader2 className={cn(iconClassName, 'animate-spin')} />
      ) : (
        <Trash2 className={iconClassName} />
      )}
    </Button>
  );
}

function SessionRail({
  sessionId,
  sessions,
  isLoading,
  unreadSessionIds,
  deletingSessionId,
  onDeleteSession,
}: {
  sessionId?: string;
  sessions: ReturnType<typeof useOperatorSessions>['data'];
  isLoading: boolean;
  unreadSessionIds: ReadonlySet<string>;
  deletingSessionId: string | null;
  onDeleteSession: (session: OperatorSessionSummary) => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sentris:operator-session-rail-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem('sentris:operator-session-rail-collapsed', String(next));
      } catch {
        // The rail still works for this page load when storage is unavailable.
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-border/60 bg-background/80 backdrop-blur-xl transition-[width] duration-200 md:flex',
        collapsed ? 'w-14' : 'w-56 lg:w-64',
      )}
    >
      <div
        className={cn(
          'border-b border-border/50',
          collapsed
            ? 'flex flex-col items-center gap-1 p-1.5'
            : 'flex h-10 items-center justify-between px-3',
        )}
      >
        {collapsed ? null : (
          <span className="text-xs font-semibold text-muted-foreground">Sessions</span>
        )}
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'gap-1')}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={collapsed ? 'Expand chat sessions' : 'Collapse chat sessions'}
            title={collapsed ? 'Expand chat sessions' : 'Collapse chat sessions'}
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
            <Link to="/operator" aria-label="New Operator session" title="New Operator session">
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
      <nav
        className={cn(
          'min-h-0 flex-1 space-y-1 overflow-y-auto',
          collapsed ? 'px-1.5 py-2' : 'p-2',
        )}
        aria-label="Operator sessions"
      >
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton
                key={index}
                className={collapsed ? 'h-10 w-10 rounded-xl' : 'h-14 w-full'}
              />
            ))
          : null}
        {!collapsed && !isLoading && sessions?.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Your Operator conversations will appear here.
          </p>
        ) : null}
        {sessions?.map((session) => {
          return (
            <div key={session.id} className="group relative">
              <Link
                to={`/operator/${session.id}`}
                aria-current={session.id === sessionId ? 'page' : undefined}
                aria-label={`${session.title}${unreadSessionIds.has(session.id) ? ', unread activity' : ''}`}
                title={collapsed ? session.title : undefined}
                className={cn(
                  'border border-transparent transition-colors',
                  collapsed
                    ? 'relative flex h-10 w-10 items-center justify-center rounded-xl'
                    : 'block rounded-lg px-2.5 py-2 pr-9',
                  session.id === sessionId
                    ? 'border-border/80 bg-muted/55 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/35 hover:text-foreground',
                )}
              >
                {collapsed ? (
                  <>
                    <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                    {unreadSessionIds.has(session.id) ? (
                      <span
                        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {session.title}
                      </span>
                      {unreadSessionIds.has(session.id) ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {formatUpdatedAt(session.updatedAt)}
                    </span>
                  </>
                )}
              </Link>
              {collapsed ? null : (
                <DeleteSessionButton
                  session={session}
                  deletingSessionId={deletingSessionId}
                  onDeleteSession={onDeleteSession}
                  className="absolute right-1.5 top-1.5 h-6 w-6 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
                  iconClassName="h-3.5 w-3.5"
                />
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileSessionPicker({
  sessionId,
  sessions,
  unreadSessionIds,
  deletingSessionId,
  onDeleteSession,
}: {
  sessionId?: string;
  sessions: ReturnType<typeof useOperatorSessions>['data'];
  unreadSessionIds: ReadonlySet<string>;
  deletingSessionId: string | null;
  onDeleteSession: (session: OperatorSessionSummary) => void;
}) {
  const navigate = useNavigate();
  const selectedSession = sessions?.find((session) => session.id === sessionId);

  return (
    <div className="flex gap-1.5 border-b border-border/60 p-2 md:hidden">
      <label className="relative min-w-0 flex-1">
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
      {selectedSession ? (
        <DeleteSessionButton
          session={selectedSession}
          deletingSessionId={deletingSessionId}
          onDeleteSession={onDeleteSession}
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
          iconClassName="h-4 w-4"
        />
      ) : null}
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

function ActiveSession({
  session,
  activitySummary,
  handoff,
  focusTurnId,
}: {
  session: OperatorSessionDetail;
  activitySummary?: OperatorSessionSummary;
  handoff: OperatorTurnHandoff | null;
  focusTurnId: string | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const createTurn = useCreateOperatorTurn();
  const cancelTurn = useCancelOperatorTurn();
  const decideAction = useDecideOperatorAction();
  const updateSession = useUpdateOperatorSession();
  const [message, setMessage] = useState('');
  const [workflowToRun, setWorkflowToRun] = useState<OperatorWorkflowRunSelection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedHandoffRef = useRef<string | null>(null);
  const focusedTurnRef = useRef<string | null>(null);
  const isActive = operatorSessionHasActiveTurn(session, activitySummary);
  const latestTurnError = getOperatorSessionLatestTurnError(session);
  const expectedWorkflowDraftCount = session.actions.filter(
    (action) =>
      (action.commandName === 'propose_workflow_draft' ||
        action.commandName === 'propose_workflow_edits' ||
        action.commandName === 'revise_workflow_draft') &&
      action.status === 'succeeded',
  ).length;
  const workflowDraftsQuery = useOperatorWorkflowDrafts(
    session.id,
    isActive,
    expectedWorkflowDraftCount,
  );
  const journeyPipeline = projectOperatorJourneyPipeline(session);
  const composerActivity = getComposerActivity(session);

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
      options?: { clientTurnId?: string; context?: OperatorRouteContext },
    ) => {
      if (!content || isActive || createTurn.isPending) return;

      try {
        await createTurn.mutateAsync({
          sessionId: session.id,
          input: {
            clientTurnId: options?.clientTurnId ?? crypto.randomUUID(),
            message: content,
            context: options?.context ?? { path: location.pathname },
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
      context: turn.context,
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

  const decide = async (
    action: OperatorActionView,
    decision: 'approved' | 'rejected',
    response?: OperatorUserInputResponse,
  ) => {
    try {
      await decideAction.mutateAsync({
        sessionId: session.id,
        actionId: action.id,
        input: { decision, expectedVersion: action.version, ...(response ? { response } : {}) },
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
        title: 'Could not stop Operator',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const updateApprovalMode = async (approvalMode: OperatorApprovalMode) => {
    try {
      await updateSession.mutateAsync({ sessionId: session.id, input: { approvalMode } });
    } catch (error) {
      toast({
        title: 'Could not update approval mode',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:py-8">
        <div className="mx-auto max-w-[800px]">
          {journeyPipeline ? <OperatorJourneyPipeline pipeline={journeyPipeline} /> : null}
          <OperatorTimeline
            messages={session.messages}
            actions={session.actions}
            turns={session.turns}
            workflowDrafts={workflowDraftsQuery.data ?? []}
            isActive={isActive}
            pendingDecisionActionId={decideAction.variables?.actionId}
            runCommandDisabled={isActive || createTurn.isPending}
            onDecision={(action, decision, response) => void decide(action, decision, response)}
            onRunCommand={(request) =>
              void sendTurn(request.message, request.directCommand, request.journey)
            }
            onRunSavedWorkflow={setWorkflowToRun}
            pendingCancelTurnId={cancelTurn.variables?.turnId}
            onCancelTurn={(turnId) => void cancel(turnId)}
          />
          {latestTurnError ? <ErrorBanner message={latestTurnError} className="mt-3" /> : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-30 shrink-0 bg-gradient-to-t from-background via-background/98 to-transparent px-4 pb-4 pt-3">
        <form onSubmit={(event) => void submit(event)} className="mx-auto max-w-[800px]">
          {session.messages.length === 0 ? (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="shrink-0 rounded-full border border-border/70 bg-background/75 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                  onClick={() => setMessage(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          {composerActivity ? (
            <div
              className="relative z-0 mx-4 -mb-px overflow-hidden rounded-t-2xl border border-border/70 bg-card/85 px-4 pb-3 pt-2.5 shadow-[0_-12px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
                  <span className="h-1.5 w-0.5 rounded-full bg-current" />
                  <span className="h-2.5 w-0.5 rounded-full bg-current" />
                  <span className="h-3.5 w-0.5 rounded-full bg-current" />
                  <span className="h-2 w-0.5 rounded-full bg-current" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {composerActivity.label}
                </span>
                {composerActivity.stepLabel ? (
                  <span className="shrink-0 text-[10px]">{composerActivity.stepLabel}</span>
                ) : null}
              </div>
              <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full bg-blue-500 transition-[width] duration-500',
                    composerActivity.progress === undefined &&
                      !composerActivity.waitingForUser &&
                      'w-2/5 animate-pulse',
                    composerActivity.waitingForUser && 'w-full bg-amber-500/70',
                  )}
                  style={
                    composerActivity.progress === undefined
                      ? undefined
                      : { width: `${composerActivity.progress}%` }
                  }
                />
              </div>
            </div>
          ) : null}

          <div className="relative z-10 rounded-[26px] border border-border/80 bg-card/95 px-3 pb-2.5 pt-2 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={isActive ? 'Operator is completing the current turn…' : 'Ask anything…'}
              aria-label="Message Operator"
              className="min-h-[58px] resize-none border-0 bg-transparent px-1 py-2 text-[13px] shadow-none focus-visible:ring-0"
              disabled={isActive || createTurn.isPending}
              rows={2}
            />

            <div className="flex min-w-0 items-center gap-1.5">
              <details className="group relative">
                <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Suggested prompts</span>
                </summary>
                <div className="absolute bottom-[calc(100%+12px)] left-0 z-50 w-72 space-y-1 rounded-xl border border-border/80 bg-popover/98 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                  <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Quick prompts
                  </p>
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="w-full rounded-lg px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
                      onClick={() => setMessage(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </details>

              <OperatorSessionModelPicker key={session.id} session={session} />

              <OperatorModeSelect
                value={session.approvalMode}
                onChange={(mode) => void updateApprovalMode(mode)}
                disabled={updateSession.isPending}
                compact
                className="h-7 w-auto min-w-16 border-0 bg-transparent px-1.5 text-[11px] shadow-none"
              />

              <div className="ml-auto shrink-0">
                {composerActivity ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="h-8 w-8 rounded-full bg-foreground text-background hover:bg-foreground/85"
                    aria-label="Stop Operator"
                    title="Stop Operator"
                    onClick={() => void cancel(composerActivity.turnId)}
                    disabled={cancelTurn.isPending}
                  >
                    {cancelTurn.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Square className="h-3 w-3 fill-current" />
                    )}
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    aria-label="Send message"
                    disabled={!message.trim() || createTurn.isPending}
                  >
                    {createTurn.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>

      <OperatorWorkflowRunDialog
        workflow={workflowToRun}
        onOpenChange={(open) => {
          if (!open) setWorkflowToRun(null);
        }}
        onRun={(workflow, inputs, scopeId) => {
          setWorkflowToRun(null);
          void sendTurn(`Run saved workflow ${workflow.name} version ${workflow.version}`, {
            commandName: 'run_workflow',
            arguments: {
              workflowId: workflow.workflowId,
              versionId: workflow.versionId,
              inputs,
              ...(scopeId ? { scopeId } : {}),
            },
          });
        }}
      />
    </div>
  );
}

export function OperatorPage() {
  useDocumentTitle('Operator');
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const deleteSession = useDeleteOperatorSession();
  const notifications = useNotificationStore((state) => state.notifications);
  const markOperatorSessionRead = useNotificationStore((state) => state.markOperatorSessionRead);
  const dismissOperatorSession = useNotificationStore((state) => state.dismissOperatorSession);
  const revisionDraftId = searchParams.get('reviseDraftId');
  const revisionHandoff = useMemo(() => {
    if (!sessionId || !revisionDraftId) return null;
    return readOperatorTurnHandoff(
      createOperatorWorkflowDraftRevisionNavigationState(
        revisionDraftId,
        `/operator/${encodeURIComponent(sessionId)}`,
      ),
    );
  }, [revisionDraftId, sessionId]);
  const handoff = readOperatorTurnHandoff(location.state) ?? revisionHandoff;
  const sessionsQuery = useOperatorSessions();
  const sessionQuery = useOperatorSessionStream(sessionId);
  const latestSessionId = sessionsQuery.data?.[0]?.id;
  const activeSessionSummary = useMemo(
    () => sessionsQuery.data?.find((session) => session.id === sessionId),
    [sessionId, sessionsQuery.data],
  );
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
  const deletingSessionId = deleteSession.isPending ? (deleteSession.variables ?? null) : null;

  const handleDeleteSession = useCallback(
    (session: OperatorSessionSummary) => {
      if (deleteSession.isPending) return;
      if (operatorSessionSummaryHasActiveTurn(session)) {
        toast({
          title: 'This chat still has an active turn',
          description: 'Stop it or wait for it to finish, then delete the chat.',
        });
        return;
      }
      void (async () => {
        const confirmed = await confirm({
          title: 'Delete chat?',
          description: `Delete “${session.title}” and its Operator messages permanently? Workflow runs and other resources created from this chat will be kept.`,
          confirmLabel: 'Delete chat',
        });
        if (!confirmed) return;

        try {
          await deleteSession.mutateAsync(session.id);
          dismissOperatorSession(session.id);
          if (session.id === sessionId) {
            const nextSession = sessionsQuery.data?.find(
              (candidate) => candidate.id !== session.id,
            );
            navigate(nextSession ? `/operator/${nextSession.id}` : '/operator', { replace: true });
          }
          toast({ title: 'Chat deleted' });
        } catch (error) {
          toast({
            title: 'Could not delete chat',
            description: error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          });
        }
      })();
    },
    [
      confirm,
      deleteSession,
      dismissOperatorSession,
      navigate,
      sessionId,
      sessionsQuery.data,
      toast,
    ],
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
    <div className="operator-surface flex h-[calc(100dvh-2.5rem)] min-h-0 max-h-[calc(100dvh-2.5rem)] overflow-hidden">
      <SessionRail
        sessionId={sessionId}
        sessions={sessionsQuery.data}
        isLoading={sessionsQuery.isLoading}
        unreadSessionIds={unreadSessionIds}
        deletingSessionId={deletingSessionId}
        onDeleteSession={handleDeleteSession}
      />

      <section
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
        aria-busy={sessionQuery.isFetching}
      >
        <MobileSessionPicker
          sessionId={sessionId}
          sessions={sessionsQuery.data}
          unreadSessionIds={unreadSessionIds}
          deletingSessionId={deletingSessionId}
          onDeleteSession={handleDeleteSession}
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
          <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col gap-3 px-4 py-8">
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
          <ActiveSession
            session={sessionQuery.data}
            activitySummary={activeSessionSummary}
            handoff={handoff}
            focusTurnId={focusTurnId}
          />
        ) : null}
      </section>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
