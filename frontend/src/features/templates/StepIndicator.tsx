import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type PublishStep, PUBLISH_STEPS } from './publish-template-types';

export function StepIndicator({ currentStep }: { currentStep: PublishStep }) {
  const currentIndex = PUBLISH_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <nav aria-label="Publishing progress" className="flex items-center gap-1 w-full mb-4">
      {PUBLISH_STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium transition-colors',
                  isCompleted && 'bg-success text-success-foreground',
                  isCurrent && 'bg-primary text-primary-foreground',
                  !isCompleted && !isCurrent && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium whitespace-nowrap',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {index < PUBLISH_STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-1.5 mt-[-14px]',
                  index < currentIndex ? 'bg-success' : 'bg-muted',
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
