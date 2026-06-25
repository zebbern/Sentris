import type { AgentDerivedStep } from './types';
import { formatClock, formatDuration, summarizeUnknown } from './utils';
import { ExpandableText } from './ExpandableText';
import { MarkdownView } from '@/components/ui/markdown';

function AgentPromptCard({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm">
      <p className="text-[11px] uppercase text-muted-foreground">Agent Prompt</p>
      <p className="mt-1 whitespace-pre-wrap text-foreground">{prompt}</p>
    </div>
  );
}

function AgentStepCard({ step }: { step: AgentDerivedStep }) {
  const label = step.stepNumber ? `Step ${step.stepNumber}` : 'Step';
  const badge = step.isComplete ? (step.finishReason ?? 'complete') : 'working';
  const showActions = step.actions && step.actions.length > 1;
  const additionalObservations =
    step.observations && step.observations.length > (step.toolOutput ? 1 : 0);
  const startedAt = step.startedAt ? formatClock(step.startedAt) : null;
  const finishedAt = step.finishedAt ? formatClock(step.finishedAt) : null;
  const duration = step.durationMs && step.durationMs > 0 ? formatDuration(step.durationMs) : null;
  const toolInputSummary =
    step.toolInput !== null && step.toolInput !== undefined
      ? summarizeUnknown(step.toolInput)
      : null;
  const toolOutputSummary =
    step.toolOutput !== null && step.toolOutput !== undefined
      ? summarizeUnknown(step.toolOutput)
      : null;
  const toolErrorSummary =
    step.toolError !== null && step.toolError !== undefined
      ? summarizeUnknown(step.toolError)
      : null;

  return (
    <div className="space-y-3 rounded-lg border bg-background/80 p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          {label}
        </span>
        {badge && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {badge}
          </span>
        )}
      </div>
      {(startedAt || finishedAt || duration) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {startedAt && <span>Start {startedAt}</span>}
          {finishedAt && <span>End {finishedAt}</span>}
          {duration && <span>{duration}</span>}
        </div>
      )}
      {!step.isComplete && (
        <p className="text-[11px] font-semibold text-amber-600">Waiting for tool output…</p>
      )}
      {(step.toolName || step.toolCallId) && (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-2">
          <p className="text-xs font-semibold text-foreground">
            {step.toolName ?? 'Tool invocation'}
          </p>
          {toolInputSummary && (
            <p className="text-muted-foreground">
              Input: <span className="text-foreground">{toolInputSummary}</span>
            </p>
          )}
          {toolErrorSummary && (
            <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2">
              <p className="text-[11px] font-semibold uppercase text-destructive">Tool error</p>
              <p className="mt-1 text-destructive">{toolErrorSummary}</p>
            </div>
          )}
          {toolOutputSummary && (
            <p className="text-muted-foreground">
              Output: <span className="text-foreground">{toolOutputSummary}</span>
            </p>
          )}
          {step.toolCallId && (
            <p className="mt-1 text-[10px] text-muted-foreground">Call ID: {step.toolCallId}</p>
          )}
        </div>
      )}
      {showActions && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">Actions</p>
          <ul className="space-y-1">
            {step.actions.map((action, index) => (
              <li
                key={action.toolCallId ?? `${action.toolName}-action-${index}`}
                className="rounded-md bg-background/70 px-2 py-1"
              >
                <p className="font-semibold">{action.toolName ?? 'tool'}</p>
                {action.args !== undefined && action.args !== null && (
                  <p className="text-muted-foreground">{summarizeUnknown(action.args)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {additionalObservations && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase text-muted-foreground">Observations</p>
          <ul className="space-y-1">
            {step.observations.map((observation, index) => (
              <li
                key={observation.toolCallId ?? `${observation.toolName}-observation-${index}`}
                className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1"
              >
                <p className="font-semibold">{observation.toolName ?? 'tool'}</p>
                {observation.result !== undefined && observation.result !== null && (
                  <p className="text-muted-foreground">{summarizeUnknown(observation.result)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.thought && <ExpandableText text={step.thought} className="text-sm text-foreground" />}
    </div>
  );
}

function AgentFinalResponseCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm shadow-sm">
      <p className="text-[11px] uppercase text-primary">Final Answer</p>
      <MarkdownView
        content={text}
        className="mt-1 max-w-none text-sm leading-relaxed text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3"
      />
    </div>
  );
}

interface AgentTranscriptTimelineProps {
  prompt?: string | null;
  steps: AgentDerivedStep[];
  finalText?: string | null;
}

export function AgentTranscriptTimeline({
  prompt,
  steps,
  finalText,
}: AgentTranscriptTimelineProps) {
  const hasPrompt = Boolean(prompt && prompt.trim().length > 0);
  const hasFinal = Boolean(finalText && finalText.trim().length > 0);
  const hasSteps = steps.length > 0;

  if (!hasPrompt && !hasSteps && !hasFinal) {
    return <p className="text-xs text-muted-foreground">No agent activity captured yet.</p>;
  }

  return (
    <div className="space-y-3">
      {hasPrompt && <AgentPromptCard prompt={prompt!.trim()} />}
      {hasSteps && steps.map((step) => <AgentStepCard key={step.key} step={step} />)}
      {hasFinal && <AgentFinalResponseCard text={finalText!.trim()} />}
    </div>
  );
}
