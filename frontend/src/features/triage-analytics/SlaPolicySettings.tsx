import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { useSlaPolicies, useUpsertSlaPolicies } from '@/hooks/queries/useTriageAnalyticsQueries';
import { SEVERITY_COLORS, SEVERITY_ORDER, capitalizeFirst } from './constants';

const MIN_HOURS = 1;
const MAX_HOURS = 8760; // 1 year

interface PolicyFormState {
  severity: string;
  deadlineHours: string;
  error: string;
}

function validateHours(value: string): string {
  if (!value.trim()) return 'Required';
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return 'Must be a whole number';
  if (num < MIN_HOURS) return `Minimum ${MIN_HOURS} hour`;
  if (num > MAX_HOURS) return `Maximum ${MAX_HOURS} hours`;
  return '';
}

export function SlaPolicySettings() {
  const { data, isLoading, isError, error: fetchError, refetch } = useSlaPolicies();
  const upsertMutation = useUpsertSlaPolicies();

  const [formState, setFormState] = useState<PolicyFormState[]>([]);
  const [isDirty, setIsDirty] = useState(false);

  // Sync form state from server data. This useEffect resets the form whenever the
  // fetched policies change (initial load or after mutation invalidation). This is
  // intentional: server data is the source of truth and the local form is derived state.
  useEffect(() => {
    if (!data?.policies) return;
    const initial = SEVERITY_ORDER.map((sev) => {
      const existing = data.policies.find((p) => p.severity.toLowerCase() === sev);
      return {
        severity: sev,
        deadlineHours: existing ? String(existing.deadlineHours) : '',
        error: '',
      };
    });
    setFormState(initial);
    setIsDirty(false);
  }, [data]);

  const handleHoursChange = useCallback((severity: string, value: string) => {
    setFormState((prev) =>
      prev.map((p) =>
        p.severity === severity ? { ...p, deadlineHours: value, error: validateHours(value) } : p,
      ),
    );
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    // Validate all fields
    const validated = formState.map((p) => ({
      ...p,
      error: p.deadlineHours.trim() ? validateHours(p.deadlineHours) : '',
    }));
    setFormState(validated);

    // Only include policies with values
    const policies = validated
      .filter((p) => p.deadlineHours.trim() && !p.error)
      .map((p) => ({
        severity: p.severity,
        deadlineHours: Number(p.deadlineHours),
      }));

    if (policies.length === 0) return;

    const hasErrors = validated.some((p) => p.error && p.deadlineHours.trim());
    if (hasErrors) return;

    upsertMutation.mutate({ policies });
    setIsDirty(false);
  }, [formState, upsertMutation]);

  if (isLoading) {
    return (
      <CollapsibleSection title="SLA Policy Settings" defaultOpen={false}>
        <div className="space-y-3">
          {SEVERITY_ORDER.map((sev) => (
            <Skeleton key={sev} className="h-10 w-full" />
          ))}
        </div>
      </CollapsibleSection>
    );
  }

  if (isError) {
    return (
      <CollapsibleSection title="SLA Policy Settings" defaultOpen={false}>
        <ErrorBanner
          message={fetchError?.message ?? 'Failed to load SLA policies'}
          onRetry={() => refetch()}
        />
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection title="SLA Policy Settings" defaultOpen={false}>
      <p className="text-xs text-muted-foreground mb-4">
        Set remediation deadline hours per severity. Findings exceeding these thresholds will be
        flagged as SLA violations. Leave empty to skip a severity.
      </p>
      <div className="grid gap-3">
        {formState.map((policy) => (
          <div key={policy.severity} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-24 flex-shrink-0">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: SEVERITY_COLORS[policy.severity] }}
                aria-hidden="true"
              />
              <label htmlFor={`sla-${policy.severity}`} className="text-sm font-medium">
                {capitalizeFirst(policy.severity)}
              </label>
            </div>
            <div className="flex-1 max-w-[200px]">
              <Input
                id={`sla-${policy.severity}`}
                type="number"
                min={MIN_HOURS}
                max={MAX_HOURS}
                placeholder="Hours"
                value={policy.deadlineHours}
                onChange={(e) => handleHoursChange(policy.severity, e.target.value)}
                aria-invalid={!!policy.error}
                aria-describedby={policy.error ? `sla-error-${policy.severity}` : undefined}
                className={policy.error ? 'border-destructive' : ''}
              />
            </div>
            <span className="text-xs text-muted-foreground">hours</span>
            {policy.error && (
              <span
                id={`sla-error-${policy.severity}`}
                className="text-xs text-destructive"
                role="alert"
              >
                {policy.error}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <Button size="sm" onClick={handleSave} disabled={!isDirty || upsertMutation.isPending}>
          {upsertMutation.isPending ? 'Saving…' : 'Save Policies'}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
