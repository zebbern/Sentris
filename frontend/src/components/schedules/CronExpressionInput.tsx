import type { ScheduleOverlapPolicy } from '@sentris/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface CronExpressionInputProps {
  form: ScheduleFormState;
  cronError: string | null;
  onFieldChange: <K extends keyof ScheduleFormState>(key: K, value: ScheduleFormState[K]) => void;
}

export function CronExpressionInput({ form, cronError, onFieldChange }: CronExpressionInputProps) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Cron expression</Label>
          <Input
            value={form.cronExpression}
            onChange={(event) => onFieldChange('cronExpression', event.target.value)}
            placeholder="0 9 * * MON-FRI"
            className={cn('font-mono text-sm', cronError && 'border-destructive')}
          />
          {cronError ? (
            <p className="text-sm text-destructive">{cronError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Use standard cron syntax. Temporal handles catch-up windows.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Timezone</Label>
          <Input
            value={form.timezone}
            onChange={(event) => onFieldChange('timezone', event.target.value)}
            placeholder="UTC or America/New_York"
          />
          <p className="text-xs text-muted-foreground">Provide an IANA timezone identifier.</p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Friendly label</Label>
          <Input
            value={form.humanLabel}
            onChange={(event) => onFieldChange('humanLabel', event.target.value)}
            placeholder="Weekday mornings"
          />
          <p className="text-xs text-muted-foreground">
            Optional alias shown beside the cron string.
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Overlap policy</Label>
          <Select
            value={form.overlapPolicy}
            onValueChange={(value) =>
              onFieldChange('overlapPolicy', value as ScheduleOverlapPolicy)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OVERLAP_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Catch-up window (seconds)</Label>
          <Input
            type="number"
            min={0}
            value={form.catchupWindowSeconds}
            onChange={(event) => onFieldChange('catchupWindowSeconds', event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            How long Temporal should keep missed runs queued.
          </p>
        </div>
      </div>
    </section>
  );
}
