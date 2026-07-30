import type { ScheduleOverlapPolicy } from '@sentris/shared';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ScheduleFormState } from './scheduleTypes';
import { OVERLAP_OPTIONS } from './scheduleTypes';
import { FieldHintLabel } from './FieldHintLabel';

interface CronExpressionInputProps {
  form: ScheduleFormState;
  cronError: string | null;
  onFieldChange: <K extends keyof ScheduleFormState>(key: K, value: ScheduleFormState[K]) => void;
}

export function CronExpressionInput({ form, cronError, onFieldChange }: CronExpressionInputProps) {
  return (
    <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <FieldHintLabel hint="Use standard cron syntax. Temporal handles catch-up windows.">
            Cron expression
          </FieldHintLabel>
          <Input
            value={form.cronExpression}
            onChange={(event) => onFieldChange('cronExpression', event.target.value)}
            placeholder="0 9 * * MON-FRI"
            className={cn('h-9 font-mono text-sm', cronError && 'border-destructive')}
          />
          {cronError ? <p className="text-xs text-destructive">{cronError}</p> : null}
        </div>
        <div className="space-y-1.5">
          <FieldHintLabel hint="Provide an IANA timezone identifier (e.g. Europe/Berlin, UTC).">
            Timezone
          </FieldHintLabel>
          <Input
            value={form.timezone}
            onChange={(event) => onFieldChange('timezone', event.target.value)}
            placeholder="UTC or America/New_York"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <FieldHintLabel hint="Optional alias shown beside the cron string.">
            Friendly label
          </FieldHintLabel>
          <Input
            value={form.humanLabel}
            onChange={(event) => onFieldChange('humanLabel', event.target.value)}
            placeholder="Weekday mornings"
            className="h-9"
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <FieldHintLabel hint="Controls what happens if a previous run is still executing when the next schedule fires.">
            Overlap policy
          </FieldHintLabel>
          <Select
            value={form.overlapPolicy}
            onValueChange={(value) =>
              onFieldChange('overlapPolicy', value as ScheduleOverlapPolicy)
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OVERLAP_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <FieldHintLabel hint="How long Temporal should keep missed runs queued.">
            Catch-up window (seconds)
          </FieldHintLabel>
          <Input
            type="number"
            min={0}
            value={form.catchupWindowSeconds}
            onChange={(event) => onFieldChange('catchupWindowSeconds', event.target.value)}
            className="h-9"
          />
        </div>
      </div>
    </section>
  );
}
