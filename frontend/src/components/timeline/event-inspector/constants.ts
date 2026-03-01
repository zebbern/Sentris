import { FileText, AlertCircle, CheckCircle, Activity, X, Wrench } from 'lucide-react';
import type { TimelineEvent } from '@/store/executionTimelineStore';
import type { EventLayoutVariant } from './types';

export const EVENT_ICONS: Partial<Record<TimelineEvent['type'], typeof FileText>> = {
  STARTED: CheckCircle,
  COMPLETED: CheckCircle,
  FAILED: AlertCircle,
  PROGRESS: Activity,
  AWAITING_INPUT: AlertCircle,
  SKIPPED: X,
  HTTP_REQUEST_SENT: Wrench,
  HTTP_RESPONSE_RECEIVED: Wrench,
  HTTP_REQUEST_ERROR: AlertCircle,
};

export const EVENT_ICON_TONE: Record<TimelineEvent['type'], string> = {
  STARTED:
    'text-violet-600 border-violet-200 bg-violet-50 dark:text-violet-200 dark:border-violet-500/40 dark:bg-violet-500/10',
  PROGRESS:
    'text-sky-600 border-sky-200 bg-sky-50 dark:text-sky-200 dark:border-sky-500/40 dark:bg-sky-500/10',
  COMPLETED:
    'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-200 dark:border-emerald-500/40 dark:bg-emerald-500/10',
  FAILED:
    'text-rose-600 border-rose-200 bg-rose-50 dark:text-rose-200 dark:border-rose-500/40 dark:bg-rose-500/10',
  AWAITING_INPUT:
    'text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-200 dark:border-amber-500/40 dark:bg-amber-500/10',
  SKIPPED:
    'text-slate-500 border-slate-200 bg-slate-50 dark:text-slate-400 dark:border-slate-500/40 dark:bg-slate-500/10',
  HTTP_REQUEST_SENT:
    'text-cyan-600 border-cyan-200 bg-cyan-50 dark:text-cyan-200 dark:border-cyan-500/40 dark:bg-cyan-500/10',
  HTTP_RESPONSE_RECEIVED:
    'text-teal-600 border-teal-200 bg-teal-50 dark:text-teal-200 dark:border-teal-500/40 dark:bg-teal-500/10',
  HTTP_REQUEST_ERROR:
    'text-rose-600 border-rose-200 bg-rose-50 dark:text-rose-200 dark:border-rose-500/40 dark:bg-rose-500/10',
};

export const LEVEL_BADGE: Record<string, 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
  debug: 'outline',
};

export const INSIGNIFICANT_PAYLOAD_KEYS = new Set(['stream', 'origin']);

export const EVENT_LAYOUT_PRESETS: Record<
  EventLayoutVariant,
  {
    li: string;
    button: string;
    iconWrap: string;
    title: string;
    meta: string;
    message: string;
  }
> = {
  'stacked-soft': {
    li: 'px-3 py-2 transition-colors',
    button: 'rounded-md',
    iconWrap: 'h-7 w-7 border',
    title: 'text-sm font-semibold',
    meta: 'text-xs text-muted-foreground',
    message: 'text-xs text-muted-foreground/90',
  },
  'stacked-contrast': {
    li: 'px-3 py-3 transition-colors bg-white/80 dark:bg-neutral-900/80 backdrop-blur',
    button: 'rounded-md',
    iconWrap: 'h-8 w-8 border-2',
    title: 'text-sm font-semibold tracking-wide',
    meta: 'text-[11px] text-muted-foreground',
    message: 'text-[11px] text-muted-foreground',
  },
  'stacked-rail': {
    li: 'px-3 py-3 transition-colors border-l-2',
    button: 'rounded-none',
    iconWrap: 'h-6 w-6 border',
    title: 'text-[13px] font-semibold uppercase',
    meta: 'text-[11px] text-muted-foreground',
    message: 'text-[11px] text-muted-foreground/90',
  },
};
