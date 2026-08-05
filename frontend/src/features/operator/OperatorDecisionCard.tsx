import {
  OperatorRequestUserInputSchema,
  OperatorUserInputResultSchema,
  type OperatorActionView,
  type OperatorUserInputResponse,
} from '@sentris/shared';
import { ArrowLeft, Check, Loader2, MessageCircleQuestion, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface OperatorDecisionCardProps {
  action: OperatorActionView;
  pending: boolean;
  onDecision: (
    action: OperatorActionView,
    decision: 'approved' | 'rejected',
    response?: OperatorUserInputResponse,
  ) => void;
}

export function OperatorDecisionCard({ action, pending, onDecision }: OperatorDecisionCardProps) {
  const request =
    action.commandName === 'request_user_input'
      ? OperatorRequestUserInputSchema.safeParse(action.arguments)
      : null;
  const parsedRequest = request?.success ? request.data : null;
  const [replying, setReplying] = useState(
    Boolean(parsedRequest && !parsedRequest.options?.length),
  );
  const [response, setResponse] = useState('');

  if (action.status !== 'pending_approval') {
    const answer = OperatorUserInputResultSchema.safeParse(action.result);
    if (!answer.success) return null;
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5 text-xs">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-foreground">Answered</p>
          <p className="mt-0.5 break-words text-muted-foreground">{answer.data.response}</p>
        </div>
      </div>
    );
  }

  const submitResponse = (value: string, selectedOption?: string) => {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    onDecision(action, 'approved', {
      response: trimmed,
      ...(selectedOption ? { selectedOption } : {}),
    });
  };

  const submitRevision = () => {
    const trimmed = response.trim();
    if (!trimmed || pending) return;
    onDecision(action, 'rejected', { response: trimmed });
  };

  if (replying) {
    return (
      <div className="space-y-3">
        {parsedRequest ? (
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
              <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{parsedRequest.question}</p>
              {parsedRequest.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {parsedRequest.description}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-xl border border-blue-500/35 bg-background/70 px-3 py-2 shadow-[0_0_0_1px_rgba(59,130,246,0.04)] focus-within:border-blue-500/65">
          <ArrowLeft className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
          <Input
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (parsedRequest) submitResponse(response);
              else submitRevision();
            }}
            placeholder={parsedRequest ? 'Type your answer…' : 'Tell Operator what to change…'}
            aria-label={parsedRequest ? 'Answer Operator question' : 'Tell Operator what to change'}
            className="h-8 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
            disabled={pending}
            autoFocus
          />
          <span className="rounded-md border border-blue-500/35 bg-blue-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400">
            Reply
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-3">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full text-xs"
            onClick={() => {
              setReplying(false);
              setResponse('');
            }}
            disabled={pending}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full border-blue-500/40 text-xs text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            onClick={() => {
              if (parsedRequest) submitResponse(response);
              else submitRevision();
            }}
            disabled={!response.trim() || pending}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send'}
          </Button>
        </div>
      </div>
    );
  }

  if (parsedRequest) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
            <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{parsedRequest.question}</p>
            {parsedRequest.description ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {parsedRequest.description}
              </p>
            ) : null}
          </div>
        </div>
        {parsedRequest.options?.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {parsedRequest.options.map((option) => (
              <Button
                key={option}
                type="button"
                variant="outline"
                className="h-auto min-h-9 justify-start rounded-xl px-3 py-2 text-left text-xs font-normal"
                onClick={() => submitResponse(option, option)}
                disabled={pending}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            'grid gap-2 border-t border-border/50 pt-3',
            parsedRequest.allowFreeform ? 'grid-cols-2' : 'grid-cols-1',
          )}
        >
          {parsedRequest.allowFreeform ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-full text-xs"
              onClick={() => setReplying(true)}
              disabled={pending}
            >
              Other
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full border-red-500/35 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => onDecision(action, 'rejected')}
            disabled={pending}
          >
            <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <p>Operator wants to perform this consequential action. Review it before continuing.</p>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3">
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full text-xs"
          onClick={() => setReplying(true)}
          disabled={pending}
        >
          Other
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-red-500/35 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
          onClick={() => onDecision(action, 'rejected')}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-emerald-500/40 text-xs text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
          onClick={() => onDecision(action, 'approved')}
          disabled={pending}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Approve'}
        </Button>
      </div>
    </div>
  );
}
