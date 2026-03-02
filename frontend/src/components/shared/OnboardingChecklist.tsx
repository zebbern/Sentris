import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Rocket, Workflow, Puzzle, Play, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'sentris-onboarding-dismissed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  isComplete: boolean;
  href?: string;
}

interface OnboardingChecklistProps {
  /** Total number of workflows the user has created. */
  totalWorkflows: number;
  /** Whether any workflow has at least one node (component). */
  hasWorkflowWithNodes: boolean;
  /** Total number of workflow runs. */
  totalRuns: number;
  /** True while dashboard data is still loading. */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingChecklist({
  totalWorkflows,
  hasWorkflowWithNodes,
  totalRuns,
  isLoading,
}: OnboardingChecklistProps) {
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
  }, []);

  useEffect(() => {
    if (!isExiting) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        // localStorage unavailable — still dismiss in-memory
      }
      setIsDismissed(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [isExiting]);

  const items: ChecklistItem[] = useMemo(
    () => [
      {
        id: 'create-workflow',
        label: 'Create your first workflow',
        description: 'Design a security automation workflow in the visual builder.',
        icon: Workflow,
        isComplete: totalWorkflows > 0,
        href: '/workflows/new',
      },
      {
        id: 'add-component',
        label: 'Add a component to your workflow',
        description: 'Drag components from the palette onto the canvas.',
        icon: Puzzle,
        isComplete: hasWorkflowWithNodes,
      },
      {
        id: 'run-workflow',
        label: 'Run a workflow',
        description: 'Execute a workflow and review the results.',
        icon: Play,
        isComplete: totalRuns > 0,
      },
    ],
    [totalWorkflows, hasWorkflowWithNodes, totalRuns],
  );

  const completedCount = items.filter((i) => i.isComplete).length;
  const progressPercent = Math.round((completedCount / items.length) * 100);
  const isAllComplete = completedCount === items.length;

  // Don't render if dismissed or still loading initial data
  if (isDismissed || isLoading) return null;

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-transparent',
        'motion-safe:animate-[fadeSlideIn_300ms_ease-out]',
        isExiting && 'motion-safe:animate-[fadeSlideOut_200ms_ease-in_forwards]',
      )}
      role="region"
      aria-label="Getting started checklist"
    >
      <CardContent className="p-5 sm:p-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Rocket className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                {isAllComplete ? "You're all set!" : 'Get started with Sentris'}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isAllComplete
                  ? "You've completed all the getting-started steps."
                  : 'Complete these steps to start automating your security workflows.'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            aria-label="Dismiss onboarding checklist"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {completedCount} of {items.length} completed
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Onboarding progress"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-out',
                isAllComplete ? 'bg-emerald-500' : 'bg-primary',
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Checklist items */}
        <ul className="mt-4 space-y-2" aria-label="Onboarding steps">
          {items.map((item) => {
            const Icon = item.icon;
            const StatusIcon = item.isComplete ? CheckCircle2 : Circle;

            const content = (
              <div
                className={cn(
                  'flex items-start gap-3 rounded-md p-2.5 transition-colors',
                  !item.isComplete && item.href && 'hover:bg-muted/50 cursor-pointer',
                  item.isComplete && 'opacity-60',
                )}
              >
                <StatusIcon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    item.isComplete ? 'text-emerald-500' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', item.isComplete && 'line-through')}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            );

            return (
              <li key={item.id}>
                {item.href && !item.isComplete ? (
                  <Link to={item.href} className="block no-underline" aria-label={item.label}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
